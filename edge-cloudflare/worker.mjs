/** Undeployed paper-only scheduler and optional read-only Kite market sampler.
 * SQLite-backed DO storage uses transactional KV. No order endpoint, Telegram,
 * broker SDK, filesystem or constructor alarm scheduling. Runtime is opt-in.
 */
import { assessAlarm, validClaimedTickId, NSE_FO_CALENDAR_VERSION } from './alarm-core.mjs';
import { verifyDailyRelay, sealDailyToken, openDailyToken, expiryForSignedSecond } from './daily-token.mjs';
import { createReadOnlyKite } from './market-readonly.mjs';
import { reviewReadOnlyMarket } from './market-review.mjs';
import { discoverAtmNiftyOptionPair, validatePairEvidence } from './option-readonly.mjs';
import { READONLY_QUOTE_PACE_KEY, READONLY_OPTION_STATE_KEY,
  reserveQuoteRequest, recordQuoteFailure, clearQuoteAuthBlock, quotePaceStatus,
  claimMasterFetch, commitMasterPair,
  noteMasterFailure, claimOptionSnapshot, finishOptionSnapshot, noteOptionFailure,
  optionStatus, validateOptionRuntime } from './option-runtime.mjs';
import { READONLY_PAPER_LEDGER_KEY, READONLY_PAPER_BRIDGE_KEY,
  newReadOnlyBridge, stageReadOnlyReview, advanceReadOnlyPaperTurn,
  readOnlyBridgeSummary } from './readonly-paper-bridge.mjs';
import { PAPER_LEDGER_KEY, newPaperLedger, auditPaperLedger,
  enterPaperBasket, exitPaperPosition, markPaperUnverifiable,
  paperLedgerSummary } from './paper-ledger.mjs';
import { SYNTHETIC_SESSION_KEY, newSyntheticSession, auditSyntheticSession,
  advanceSyntheticMarketTurn, syntheticSessionSummary } from './synthetic-session.mjs';
import { isPrivateDashboardPath, handlePrivateDashboard } from './private-dashboard.mjs';
import { PORTFOLIO_MARKS_KEY, auditPortfolioMarks,
  captureSyntheticPortfolioMarks } from './portfolio-valuation.mjs';
import { PAPER_DELIVERY_KEY, newPaperDeliveryJournal,
  claimPaperDelivery, settlePaperDelivery, suppressAmbiguousDelivery,
  paperDeliverySummary } from './paper-delivery.mjs';
import { assessOfflineRelease } from './release-readiness.mjs';

const STATE_KEY = 'scheduler-v1';
const MAX_DAILY_CALLBACKS = 4096;
const RETAINED_EVENTS = 128;
const TOKEN_KEY = 'daily-token-v1';
const MARKET_KEY = 'market-observation-v1';
const RETAINED_NONCES = 96;
const reply = (data, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

async function authorized(request, env) {
  const key = env.SCHEDULER_ADMIN_KEY;
  const candidate = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (typeof key !== 'string' || key.length < 32 || key.length > 256 ||
      new Set(key).size < 8 || !candidate || candidate.length > 256) return false;
  // Compare fixed-size digests without a secret-dependent early exit.
  const hash = (s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [a, b] = await Promise.all([hash(key), hash(candidate)]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}

function validState(s) {
  return s && Object.keys(s).sort().join(',') ===
    'calendarVersion,callbacks,events,halted,lastClaimedTickId,lastObservedAtMs,scheduledAtMs,schema,status,totalClaims,usageDay' &&
    s.schema === 1 && s.calendarVersion === NSE_FO_CALENDAR_VERSION &&
    Number.isSafeInteger(s.lastObservedAtMs) && s.lastObservedAtMs > 0 &&
    (s.scheduledAtMs === null || (Number.isSafeInteger(s.scheduledAtMs) && s.scheduledAtMs > 0)) &&
    (s.lastClaimedTickId === null || validClaimedTickId(s.lastClaimedTickId)) &&
    ((s.totalClaims === 0) === (s.lastClaimedTickId === null)) &&
    typeof s.halted === 'boolean' && typeof s.status === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s.usageDay) &&
    Number.isSafeInteger(s.callbacks) && s.callbacks >= 0 && s.callbacks <= MAX_DAILY_CALLBACKS &&
    Number.isSafeInteger(s.totalClaims) && s.totalClaims >= 0 &&
    Array.isArray(s.events) && s.events.length <= RETAINED_EVENTS &&
    s.events.every(e => e && typeof e.status === 'string' &&
      Number.isSafeInteger(e.scheduledAtMs) && Number.isSafeInteger(e.observedAtMs) &&
      (e.tickId === null || typeof e.tickId === 'string'));
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const dashboardRoute = isPrivateDashboardPath(path) &&
      env.OFFLINE_PRIVATE_DASHBOARD_ENABLED === 'true' &&
      (env.OFFLINE_PAPER_LEDGER_ENABLED === 'true' ||
       env.OFFLINE_PAPER_BRIDGE_ENABLED === 'true');
    const tokenRoute = path === '/internal/token' && request.method === 'POST';
    if (!tokenRoute && !dashboardRoute && (!((path === '/internal/bootstrap' && request.method === 'POST') ||
          (path === '/internal/emergency-halt' && request.method === 'POST') ||
          (path === '/internal/scheduler' && request.method === 'GET') ||
          (path === '/internal/release-readiness' && request.method === 'GET') ||
          (path === '/internal/paper-ledger' && request.method === 'GET') ||
          (path === '/internal/readonly-paper' && request.method === 'GET') ||
          (path === '/internal/synthetic-session' && request.method === 'GET')) ||
        !await authorized(request, env))) return reply({ error: 'Not found' }, 404);
    if (env.OFFLINE_SCHEDULER_ENABLED !== 'true' || !env.MARKET_SESSION) {
      return reply({ status: 'DISABLED', paperOnly: true }, 503);
    }
    if (tokenRoute && (env.READONLY_MARKET_RUNTIME_ENABLED !== 'true' ||
        new URL(request.url).protocol !== 'https:')) return reply({ error: 'Not found' }, 404);
    const id = env.MARKET_SESSION.idFromName('nifty-paper-session-v1');
    return env.MARKET_SESSION.get(id).fetch(request);
  },
};

export class MarketSession {
  constructor(ctx, env) {
    this.storage = ctx.storage;
    this.env = env;
  }

  get readonlyPaperEnabled() {
    return this.env.OFFLINE_PAPER_BRIDGE_ENABLED==='true' &&
      this.env.OFFLINE_OPTION_SNAPSHOT_ENABLED==='true' &&
      this.env.OFFLINE_READONLY_REVIEW_ENABLED==='true' &&
      this.env.READONLY_MARKET_RUNTIME_ENABLED==='true' &&
      this.env.OFFLINE_SCHEDULER_ENABLED==='true';
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (isPrivateDashboardPath(path)) {
      return handlePrivateDashboard(request, this.env, this.storage,
        STATE_KEY, PAPER_LEDGER_KEY, SYNTHETIC_SESSION_KEY, PORTFOLIO_MARKS_KEY);
    }
    const tokenRoute = path === '/internal/token' && request.method === 'POST' &&
      new URL(request.url).protocol === 'https:' && this.env.READONLY_MARKET_RUNTIME_ENABLED === 'true';
    if (!tokenRoute && !await authorized(request, this.env)) return reply({ error: 'Not found' }, 404);
    if (this.env.OFFLINE_SCHEDULER_ENABLED !== 'true') return reply({ status: 'DISABLED' }, 503);
    try {
      if (tokenRoute) return await this.acceptSignedToken(request);
      if (path === '/internal/scheduler' && request.method === 'GET') {
        const saved = await this.storage.get(STATE_KEY);
        if (saved === undefined) return reply({ status: 'NOT_INITIALIZED', paperOnly: true });
        if (!validState(saved)) return reply({ status: 'BLOCKED_CORRUPT_STATE' }, 503);
        const [market, option, pace] = await Promise.all([
          this.storage.get(MARKET_KEY), this.storage.get(READONLY_OPTION_STATE_KEY),
          this.storage.get(READONLY_QUOTE_PACE_KEY),
        ]);
        let optionReview;
        try { optionReview = optionStatus(option, Date.now()); }
        catch { optionReview = { status: 'BLOCKED_CORRUPT_OPTION_STATE', paperEntryAuthorized:false }; }
        let marketPacing;
        try { marketPacing = quotePaceStatus(pace,Date.now()); }
        catch { marketPacing = { status:'BLOCKED_CORRUPT_RATE_STATE' }; }
        return reply({ ...saved, paperOnly: true, marketRuntimeImplemented: true,
          marketRuntimeEnabled: this.env.READONLY_MARKET_RUNTIME_ENABLED === 'true',
          market: market && validMarketObservation(market) ? market : null,
          optionReview, marketPacing, realOrdersEnabled: false });
      }
      if (path === '/internal/release-readiness' && request.method === 'GET') {
        const [scheduler, token] = await Promise.all([
          this.storage.get(STATE_KEY), this.storage.get(TOKEN_KEY),
        ]);
        if (scheduler !== undefined && !validState(scheduler))
          return reply({ status: 'BLOCKED_CORRUPT_STATE', paperOnly: true }, 503);
        const now = Date.now();
        const istDay = ms => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
        const validHandoff = validTokenRecord(token) && now < token.expiresAtMs &&
          token.signedAt * 1000 <= now && istDay(token.signedAt * 1000) === istDay(now);
        return reply(assessOfflineRelease({ nowMs: now, schedulerState: scheduler ?? null,
          dailyTokenHandoffAcknowledged: validHandoff,
          readonlyMarketRuntimeEnabled: this.env.READONLY_MARKET_RUNTIME_ENABLED === 'true' }));
      }
      if (path === '/internal/paper-ledger' && request.method === 'GET') {
        if (this.env.OFFLINE_PAPER_LEDGER_ENABLED !== 'true')
          return reply({ status: 'DISABLED', paperOnly: true }, 503);
        const stored = await this.storage.get(PAPER_LEDGER_KEY);
        if (stored === undefined) return reply({ status: 'NOT_INITIALIZED', paperOnly: true });
        try { return reply({ status: 'READY', ...paperLedgerSummary(stored) }); }
        catch { return reply({ status: 'BLOCKED_CORRUPT_PAPER_LEDGER', paperOnly: true }, 503); }
      }
      if(path==='/internal/readonly-paper'&&request.method==='GET') {
        if(!this.readonlyPaperEnabled)
          return reply({status:'DISABLED',paperOnly:true},503);
        const [bridge,ledger]=await Promise.all([
          this.storage.get(READONLY_PAPER_BRIDGE_KEY),
          this.storage.get(READONLY_PAPER_LEDGER_KEY)]);
        if(bridge===undefined||ledger===undefined)
          return reply({status:'NOT_INITIALIZED',paperOnly:true});
        try {return reply({status:'READY',...readOnlyBridgeSummary(bridge,ledger)});}
        catch {return reply({status:'BLOCKED_CORRUPT_READONLY_PAPER',paperOnly:true},503);}
      }
      if (path === '/internal/synthetic-session' && request.method === 'GET') {
        if (this.env.OFFLINE_SYNTHETIC_SESSION_ENABLED !== 'true' ||
            this.env.OFFLINE_PAPER_LEDGER_ENABLED !== 'true') {
          return reply({ status: 'DISABLED', paperOnly: true }, 503);
        }
        const [stored, ledger] = await Promise.all([
          this.storage.get(SYNTHETIC_SESSION_KEY), this.storage.get(PAPER_LEDGER_KEY),
        ]);
        if (stored === undefined || ledger === undefined)
          return reply({ status: 'NOT_INITIALIZED', syntheticOnly: true });
        try { return reply({ status: 'READY', ...syntheticSessionSummary(stored, ledger) }); }
        catch { return reply({ status: 'BLOCKED_CORRUPT_SYNTHETIC_SESSION' }, 503); }
      }
      const isBootstrap = path === '/internal/bootstrap' && request.method === 'POST';
      const isEmergencyHalt = path === '/internal/emergency-halt' && request.method === 'POST';
      if (!isBootstrap && !isEmergencyHalt) return reply({ error: 'Not found' }, 404);
      // No input or token upload is accepted by this scheduler-only endpoint.
      // workerd represents even an empty forwarded POST with a body stream.
      // Inspect at most the first chunk, never buffer arbitrary upload content.
      if (request.body !== null) {
        const reader = request.body.getReader();
        try {
          const first = await reader.read();
          if (!first.done) {
            await reader.cancel();
            return reply({ error: 'Body forbidden' }, 400);
          }
        } finally { reader.releaseLock(); }
      }
      const now = Date.now();
      if (isEmergencyHalt) {
        const outcome = await this.storage.transaction(async txn => {
          const existing = await txn.get(STATE_KEY);
          // Stop a pending callback even if state cannot safely be interpreted.
          await txn.deleteAlarm();
          if (existing !== undefined && !validState(existing)) return 'BLOCKED_CORRUPT_STATE';
          if (existing?.halted && existing.status === 'OWNER_EMERGENCY_HALT')
            return 'OWNER_EMERGENCY_HALT'; // Repeat is idempotent; preserve evidence.
          const state = existing ?? {
            schema: 1, calendarVersion: NSE_FO_CALENDAR_VERSION,
            scheduledAtMs: null, lastObservedAtMs: now, lastClaimedTickId: null,
            status: 'OWNER_EMERGENCY_HALT', halted: true,
            usageDay: new Date(now).toISOString().slice(0, 10), callbacks: 0,
            totalClaims: 0, events: [],
          };
          const priorAlarm = state.scheduledAtMs;
          state.events.push({ status: 'OWNER_EMERGENCY_HALT',
            scheduledAtMs: priorAlarm ?? now, observedAtMs: now, tickId: null });
          state.events = state.events.slice(-RETAINED_EVENTS);
          state.lastObservedAtMs = Math.max(state.lastObservedAtMs, now);
          state.scheduledAtMs = null;
          state.halted = true;
          state.status = 'OWNER_EMERGENCY_HALT';
          await txn.put(STATE_KEY, state);
          return 'OWNER_EMERGENCY_HALT';
        });
        return reply({ status: outcome, paperOnly: true,
          scheduledAtMs: null, realOrdersEnabled: false },
        outcome === 'BLOCKED_CORRUPT_STATE' ? 503 : 200);
      }
      const saved = await this.storage.transaction(async txn => {
        const existing = await txn.get(STATE_KEY);
        if (existing !== undefined) {
          if (!validState(existing)) throw new Error('invalid state');
          return existing; // Repeated bootstrap cannot reset dedupe, quota or stopped state.
        }
        const decision = assessAlarm({ observedAtMs: now, scheduledAtMs: now,
          calendarVersion: NSE_FO_CALENDAR_VERSION });
        // Bootstrap never executes an immediate tick; it arms the next future slot.
        const state = { schema: 1, calendarVersion: NSE_FO_CALENDAR_VERSION,
          scheduledAtMs: decision.nextAlarmAtMs, lastObservedAtMs: now,
          lastClaimedTickId: null, status: 'INITIALIZED', halted: decision.nextAlarmAtMs === null,
          usageDay: new Date(now).toISOString().slice(0, 10), callbacks: 0,
          totalClaims: 0, events: [] };
        if (state.scheduledAtMs !== null) await txn.setAlarm(state.scheduledAtMs);
        await txn.put(STATE_KEY, state);
        return state;
      });
      return reply({ status: saved.status, scheduledAtMs: saved.scheduledAtMs,
        paperOnly: true, marketRuntimeImplemented: true, realOrdersEnabled: false });
    } catch {
      return reply({ status: 'BLOCKED_STORAGE_OR_STATE', paperOnly: true }, 503);
    }
  }

  async acceptSignedToken(request) {
    let relay, encrypted;
    try {
      relay = await verifyDailyRelay(request, this.env);
      encrypted = await sealDailyToken(relay.token, this.env, relay);
    } catch { return reply({ error: 'Token handoff rejected' }, 401); }
    try {
      const result = await this.storage.transaction(async txn => {
        const previous = await txn.get(TOKEN_KEY);
        if (previous !== undefined && !validTokenRecord(previous)) return 'CORRUPT';
        const validPrevious = validTokenRecord(previous) && Date.now() < previous.expiresAtMs;
        if (validPrevious && previous.nonces.includes(relay.nonceHash)) return 'REPLAY';
        if (validPrevious && (relay.signedAt < previous.signedAt ||
            (relay.signedAt === previous.signedAt && relay.fingerprint !== previous.fingerprint)))
          return 'ROLLBACK';
        if (validPrevious && relay.signedAt === previous.signedAt) {
          // A different nonce but identical signed second and token is idempotent.
          previous.nonces.push(relay.nonceHash);
          previous.nonces = previous.nonces.slice(-RETAINED_NONCES);
          await txn.put(TOKEN_KEY, previous);
          return 'OK';
        }
        await txn.put(TOKEN_KEY, { schema: 1, signedAt: relay.signedAt,
          expiresAtMs: relay.expiresAtMs, fingerprint: relay.fingerprint,
          nonces: [relay.nonceHash], ...encrypted });
        // A fresh signed owner handoff re-enables the read-only quote budget
        // after HTTP 403, without clearing prior rate-limit cooldown.
        if(this.env.OFFLINE_OPTION_SNAPSHOT_ENABLED==='true') {
          const pace=await txn.get(READONLY_QUOTE_PACE_KEY);
          const cleared=clearQuoteAuthBlock(pace);
          if(cleared && cleared!==pace) await txn.put(READONLY_QUOTE_PACE_KEY,cleared);
        }
        return 'OK';
      });
      return result === 'OK' ? reply({ status: 'TOKEN_ACCEPTED' }) :
        reply({ error: 'Token handoff rejected' }, 409);
    } catch { return reply({ error: 'Token handoff unavailable' }, 503); }
  }

  /** Internal methods, not remotely exposed POST endpoints. The future signal
   * engine must separately validate a real market quote before calling them.
   * Ledger/cash/outbox writes are all-or-nothing under native DO transaction.
   */
  async withPaperLedger(operation, nowMs) {
    if (this.env.OFFLINE_SCHEDULER_ENABLED !== 'true' ||
        this.env.OFFLINE_PAPER_LEDGER_ENABLED !== 'true')
      throw new Error('PAPER_LEDGER_DISABLED');
    return this.storage.transaction(async txn => {
      const existing = await txn.get(PAPER_LEDGER_KEY);
      const current = existing === undefined ? newPaperLedger(nowMs) : existing;
      auditPaperLedger(current);
      const outcome = operation(current);
      // Even rejected trades have durable idempotent rejection journal records.
      // A HOLD or duplicate returns identical state; no new alerts are sent.
      if (outcome.ledger !== existing) await txn.put(PAPER_LEDGER_KEY, outcome.ledger);
      return { ...outcome, ledger: undefined };
    });
  }

  enterPaperBasket(input) {
    return this.withPaperLedger(state => enterPaperBasket(state, input), input?.nowMs);
  }

  exitPaperPosition(input) {
    return this.withPaperLedger(state => exitPaperPosition(state, input), input?.nowMs);
  }

  markPaperUnverifiable(nowMs) {
    return this.withPaperLedger(state => markPaperUnverifiable(state, nowMs), nowMs);
  }

  /** OFFLINE rehearsal only: durable claim/settle/suppress transitions share a
   * transaction with a read of the source paper ledger. No Bot API request
   * is made here, and no production HTTP route invokes these methods.
   * A CLAIMED_UNCONFIRMED attempt remains ambiguous after restart.
   */
  async withPaperDelivery(operation, nowMs) {
    if (this.env.OFFLINE_SCHEDULER_ENABLED !== 'true' ||
        this.env.OFFLINE_PAPER_LEDGER_ENABLED !== 'true' ||
        this.env.OFFLINE_DELIVERY_REHEARSAL_ENABLED !== 'true') {
      throw new Error('PAPER_DELIVERY_REHEARSAL_DISABLED');
    }
    return this.storage.transaction(async txn => {
      const ledger = await txn.get(PAPER_LEDGER_KEY);
      if (ledger === undefined) throw new Error('PAPER_DELIVERY_MISSING_LEDGER');
      const stored = await txn.get(PAPER_DELIVERY_KEY);
      // Missing delivery cursor alongside pre-existing alerts may mean a
      // partial restore. Never replay that historical outbox as new alerts.
      if (stored === undefined && ledger.outbox.length !== 0) {
        throw new Error('PAPER_DELIVERY_MISSING_REPLAY_WATERMARK');
      }
      const current = stored === undefined ? newPaperDeliveryJournal(nowMs) : stored;
      const outcome = operation(current, ledger);
      if (outcome.journal !== stored) await txn.put(PAPER_DELIVERY_KEY, outcome.journal);
      return { ...outcome.result };
    });
  }

  claimPaperDeliveryRehearsal(nowMs) {
    return this.withPaperDelivery((journal, ledger) =>
      claimPaperDelivery(journal, ledger, nowMs), nowMs);
  }

  settlePaperDeliveryRehearsal(input) {
    return this.withPaperDelivery((journal, ledger) =>
      settlePaperDelivery(journal, ledger, input), input?.nowMs);
  }

  suppressPaperDeliveryRehearsal(input) {
    return this.withPaperDelivery((journal, ledger) =>
      suppressAmbiguousDelivery(journal, ledger, input), input?.nowMs);
  }

  async paperDeliveryRehearsalSummary() {
    if (this.env.OFFLINE_SCHEDULER_ENABLED !== 'true' ||
        this.env.OFFLINE_PAPER_LEDGER_ENABLED !== 'true' ||
        this.env.OFFLINE_DELIVERY_REHEARSAL_ENABLED !== 'true') {
      throw new Error('PAPER_DELIVERY_REHEARSAL_DISABLED');
    }
    const [ledger, stored] = await Promise.all([
      this.storage.get(PAPER_LEDGER_KEY), this.storage.get(PAPER_DELIVERY_KEY),
    ]);
    if (!ledger || !stored) throw new Error('PAPER_DELIVERY_NOT_INITIALIZED');
    return paperDeliverySummary(stored, ledger);
  }

  /** Test-only provenance is mandatory. Production provides no HTTP POST
   * endpoint to feed this method, nor any automatic bridge from Kite polling.
   */
  async processSyntheticMarketTurn(input) {
    if (this.env.OFFLINE_SCHEDULER_ENABLED !== 'true' ||
        this.env.OFFLINE_PAPER_LEDGER_ENABLED !== 'true' ||
        this.env.OFFLINE_SYNTHETIC_SESSION_ENABLED !== 'true') {
      throw new Error('SYNTHETIC_SESSION_DISABLED');
    }
    return this.storage.transaction(async txn => {
      const [storedLedger, storedSession, storedMarks] = await Promise.all([
        txn.get(PAPER_LEDGER_KEY), txn.get(SYNTHETIC_SESSION_KEY), txn.get(PORTFOLIO_MARKS_KEY),
      ]);
      const currentLedger = storedLedger === undefined ?
        newPaperLedger(input?.observedAtMs) : storedLedger;
      const currentSession = storedSession === undefined ? newSyntheticSession() : storedSession;
      auditPaperLedger(currentLedger);
      auditSyntheticSession(currentSession);
      if (storedMarks !== undefined) auditPortfolioMarks(storedMarks, currentSession);
      const outcome = advanceSyntheticMarketTurn(currentSession, currentLedger, input);
      const newTick = outcome.result.status === 'SYNTHETIC_TICK_PROCESSED';
      const marks = newTick ?
        captureSyntheticPortfolioMarks(outcome.ledger, outcome.session, input) : storedMarks;
      if (outcome.ledger !== storedLedger) await txn.put(PAPER_LEDGER_KEY, outcome.ledger);
      if (outcome.session !== storedSession) await txn.put(SYNTHETIC_SESSION_KEY, outcome.session);
      if (newTick) await txn.put(PORTFOLIO_MARKS_KEY, marks);
      return outcome.result;
    });
  }

  async alarm() {
    // An exception before commit is retried by Cloudflare. No external effects
    // happen inside the transaction or after it, so replay cannot create fills.
    const now = Date.now();
    const decision = await this.storage.transaction(async txn => {
      const state = await txn.get(STATE_KEY);
      if (!validState(state)) {
        await txn.deleteAlarm();
        // Preserve corrupt evidence; initialization never overwrites it.
        return { status: 'BLOCKED_CORRUPT_STATE', shouldPoll: false };
      }
      const day = new Date(now).toISOString().slice(0, 10);
      let decision;
      if (this.env.OFFLINE_SCHEDULER_ENABLED !== 'true' || state.halted || state.scheduledAtMs === null) {
        decision = { status: 'HALTED', shouldPoll: false, nextAlarmAtMs: null, tickId: null };
      } else if (now < state.lastObservedAtMs) {
        decision = { status: 'BLOCKED_CLOCK_ROLLBACK', shouldPoll: false, nextAlarmAtMs: null, tickId: null };
      } else {
        if (day !== state.usageDay) { state.usageDay = day; state.callbacks = 0; }
        if (state.callbacks >= MAX_DAILY_CALLBACKS) {
          decision = { status: 'BLOCKED_LOCAL_QUOTA', shouldPoll: false, nextAlarmAtMs: null, tickId: null };
        } else {
          state.callbacks++;
          decision = assessAlarm({ observedAtMs: now, scheduledAtMs: state.scheduledAtMs,
            lastClaimedTickId: state.lastClaimedTickId, calendarVersion: state.calendarVersion });
        }
      }
      state.events.push({ status: decision.status, scheduledAtMs: state.scheduledAtMs ?? now,
        observedAtMs: now, tickId: decision.tickId ?? null });
      state.events = state.events.slice(-RETAINED_EVENTS);
      if (decision.shouldPoll) {
        state.lastClaimedTickId = decision.tickId;
        state.totalClaims++;
      }
      state.lastObservedAtMs = Math.max(state.lastObservedAtMs, now);
      state.status = decision.status;
      state.scheduledAtMs = decision.nextAlarmAtMs;
      state.halted = decision.nextAlarmAtMs === null;
      if (state.halted) await txn.deleteAlarm();
      else await txn.setAlarm(state.scheduledAtMs);
      await txn.put(STATE_KEY, state);
      return decision;
    });
    // At/after 15:26 IST an unresolved paper exit must stay unresolved even
    // if Kite is down or option sampling never returns. No invented BID fill.
    if(decision.shouldPoll&&this.readonlyPaperEnabled) {
      const local=new Date(now+330*60_000);
      if(local.getUTCHours()*60+local.getUTCMinutes()>=15*60+26)
        await this.finalizeReadOnlyPaperDay(now).catch(()=>{});
    }
    if (decision.shouldPoll && this.env.READONLY_MARKET_RUNTIME_ENABLED === 'true') {
      const optionEnabled=this.env.OFFLINE_OPTION_SNAPSHOT_ENABLED==='true';
      // Every third 20-second slot is assigned exclusively to a two-leg option
      // GET. Never issue a futures quote and an option quote in one alarm.
      const optionSlot=optionEnabled&&Number(decision.tickId.split(':')[1])%3===2;
      const market=optionSlot?await this.pollReadOnlyOptions(decision.tickId,now):
        await this.pollReadOnlyMarket(decision.tickId,now);
      return { ...decision, marketStatus: market.status };
    }
    return decision;
  }

  async pollReadOnlyMarket(tickId, nowMs) {
    let report = { schema: 1, tickId, observedAtMs: nowMs, status: 'BLOCKED_MISSING_TOKEN' };
    try {
      const stored = await this.storage.get(TOKEN_KEY);
      if (!validTokenRecord(stored)) throw new Error('invalid token state');
      const token = await openDailyToken(stored, this.env, nowMs);
      if (!token) throw new Error('expired or invalid token');
      const symbol = this.env.KITE_FUTURE_SYMBOL;
      const instrumentToken = Number(this.env.KITE_FUTURE_INSTRUMENT_TOKEN);
      if (!/^NIFTY[A-Z0-9]+FUT$/.test(symbol ?? '') ||
          !Number.isSafeInteger(instrumentToken) || instrumentToken <= 0)
        throw new Error('invalid configured future');
      if(this.env.OFFLINE_OPTION_SNAPSHOT_ENABLED==='true') {
        const claimed=await this.reserveReadOnlyQuote(tickId,nowMs,'FUTURE');
        if(!claimed.allowed) throw new Error('QUOTE_RESERVATION_BLOCKED');
      }
      const client = createReadOnlyKite({ apiKey: this.env.KITE_API_KEY, accessToken: token });
      let quote;
      try { quote=await client.quote(symbol); }
      catch(error) {
        if(this.env.OFFLINE_OPTION_SNAPSHOT_ENABLED==='true')
          await this.recordReadOnlyQuoteFailure(tickId,Date.now(),error).catch(()=>{});
        throw error;
      }
      // A plausible price without a recent exchange timestamp is NOT market evidence.
      const quoteTimestamp = quote.timestamp;
      const parsedTimestamp = typeof quoteTimestamp !== 'string' ? NaN :
        /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(quoteTimestamp) ?
          Date.parse(quoteTimestamp.replace(' ', 'T') + '+05:30') :
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/.test(quoteTimestamp) ?
            Date.parse(quoteTimestamp) : NaN;
      if (!Number.isFinite(parsedTimestamp) || nowMs - parsedTimestamp > 60_000 ||
          parsedTimestamp - nowMs > 5000 ||
          (quote.instrument_token !== undefined &&
            String(quote.instrument_token) !== String(instrumentToken)))
        throw new Error('stale or mismatched market timestamp/instrument');
      report = { schema: 1, tickId, observedAtMs: nowMs, status: 'QUOTE_OBSERVED',
        exchangeAtMs: parsedTimestamp, lastPrice: quote.last_price };
      if(this.env.OFFLINE_OPTION_SNAPSHOT_ENABLED==='true') {
        // CSV refresh is a non-quote GET, bounded to three attempts/day with
        // 30-minute retry spacing. Persist only a compact contract pair.
        await this.refreshOptionMaster(tickId,nowMs,quote.last_price,client);
      }
      // Review mode waits one 20-second slot for the five-minute candle to
      // close and pass the 8-second source-completeness guard. The old
      // observational-only cadence remains unchanged when review is disabled.
      const slot = Number(tickId.split(':')[1]);
      const reviewEnabled = this.env.OFFLINE_READONLY_REVIEW_ENABLED === 'true';
      if (slot % 15 === (reviewEnabled ? 1 : 0)) {
        const local = ms => new Date(ms + 19_800_000).toISOString().slice(0, 19).replace('T', ' ');
        // At most ~five ordinary NSE trading days of 5m bars (under the
        // transport's 400-row cap), not an unbounded week of candles.
        const from = local(nowMs - 6 * 86_400_000);
        const to = local(nowMs - 300_000);
        const [m5, m15] = await Promise.all([
          client.history(instrumentToken, '5minute', from, to),
          client.history(instrumentToken, '15minute', from, to),
        ]);
        report = { ...report, status: 'HISTORY_OBSERVED', fiveMinuteCount: m5.length,
          fifteenMinuteCount: m15.length };
        if (reviewEnabled) {
          // FUTURES-ONLY diagnostic, not a bridge into synthetic paper entries.
          // Never persist raw candles, options, Kite responses or credentials.
          report.review = reviewReadOnlyMarket({ tickId, observedAtMs: nowMs,
            futures: { symbol: `NFO:${symbol}`, instrumentToken,
              exchangeAtMs: parsedTimestamp, lastPrice: quote.last_price },
            candles5: m5, candles15: m15 });
          if(this.readonlyPaperEnabled) {
            // The only production source of pending paper signals: reviewed
            // completed Kite candles. A review alone NEVER mutates balances.
            await this.storage.transaction(async txn=>{
              const stored=await txn.get(READONLY_PAPER_BRIDGE_KEY);
              const next=stageReadOnlyReview(stored??newReadOnlyBridge(),{
                tickId,observedAtMs:nowMs,review:report.review,
                futures:{symbol:`NFO:${symbol}`,instrumentToken,
                  exchangeAtMs:parsedTimestamp,lastPrice:quote.last_price}});
              await txn.put(READONLY_PAPER_BRIDGE_KEY,next);
            });
          }
        }
      }
    } catch {
      // Never log exception text/response bodies/request headers/credentials.
      report = { schema: 1, tickId, observedAtMs: nowMs, status: 'BLOCKED_MARKET_DATA' };
    }
    try { await this.storage.put(MARKET_KEY, report); }
    catch { return { status: 'BLOCKED_OBSERVATION_STORAGE' }; }
    return report;
  }

  /** Durable one-quote-at-a-time allowance, committed before any HTTP GET. */
  async reserveReadOnlyQuote(tickId,observedAtMs,kind) {
    return this.storage.transaction(async txn=>{
      const prior=await txn.get(READONLY_QUOTE_PACE_KEY);
      const result=reserveQuoteRequest(prior,{tickId,observedAtMs,kind});
      if(result.allowed) await txn.put(READONLY_QUOTE_PACE_KEY,result.state);
      return {allowed:result.allowed,reason:result.reason};
    });
  }

  async finalizeReadOnlyPaperDay(nowMs) {
    if(!this.readonlyPaperEnabled) throw Error('READONLY_PAPER_DISABLED');
    return this.storage.transaction(async txn=>{
      const old=await txn.get(READONLY_PAPER_LEDGER_KEY);
      if(!old) return {marked:0};
      auditPaperLedger(old);
      if(!old.positions.some(p=>p.status==='OPEN')) return {marked:0};
      const result=markPaperUnverifiable(old,nowMs);
      if(result.marked.length) await txn.put(READONLY_PAPER_LEDGER_KEY,result.ledger);
      return {marked:result.marked.length};
    });
  }

  async recordReadOnlyQuoteFailure(tickId,observedAtMs,error) {
    const code=error?.message==='KITE_READONLY_AUTH_EXPIRED'?'AUTH_EXPIRED':
      error?.message==='KITE_READONLY_RATE_LIMITED'?'RATE_LIMITED':null;
    if(!code) return;
    await this.storage.transaction(async txn=>{
      const prior=await txn.get(READONLY_QUOTE_PACE_KEY);
      await txn.put(READONLY_QUOTE_PACE_KEY,
        recordQuoteFailure(prior,{tickId,observedAtMs,errorCode:code}));
    });
  }

  async refreshOptionMaster(tickId,nowMs,futuresLastPrice,client) {
    let claimed;
    try {
      claimed=await this.storage.transaction(async txn=>{
        const old=await txn.get(READONLY_OPTION_STATE_KEY);
        const r=claimMasterFetch(old,{tickId,observedAtMs:nowMs});
        if(r.state!==old) await txn.put(READONLY_OPTION_STATE_KEY,r.state);
        return r.allowed;
      });
    } catch { return; } // Do not compromise an independently valid futures read.
    if(!claimed) return;
    try {
      const csv=await client.instrumentsNfoCsv();
      const observed=Date.now();
      const pair=discoverAtmNiftyOptionPair(csv,{observedAtMs:observed,
        masterFetchedAtMs:observed,futuresLastPrice});
      await this.storage.transaction(async txn=>{
        const old=await txn.get(READONLY_OPTION_STATE_KEY);
        await txn.put(READONLY_OPTION_STATE_KEY,commitMasterPair(old,{tickId,pair}));
      });
    } catch {
      try {await this.storage.transaction(async txn=>{
        const old=await txn.get(READONLY_OPTION_STATE_KEY);
        await txn.put(READONLY_OPTION_STATE_KEY,noteMasterFailure(old,{tickId}));
      });} catch { /* preserve evidence on unexpected storage/state failures */ }
    }
  }

  /** Option-only alarm; NEVER fed to the synthetic entry/exit pipeline. */
  async pollReadOnlyOptions(tickId,nowMs) {
    let report={schema:1,tickId,observedAtMs:nowMs,status:'OPTION_BLOCKED'};
    let claimed=false;
    try {
      const pair=await this.storage.transaction(async txn=>{
        const old=await txn.get(READONLY_OPTION_STATE_KEY);
        const r=claimOptionSnapshot(old,{tickId,observedAtMs:nowMs});
        if(r.state!==old) await txn.put(READONLY_OPTION_STATE_KEY,r.state);
        claimed=r.allowed;
        return r.allowed?r.state.pair:null;
      });
      if(!pair) {report.status='OPTION_NO_MASTER';}
      else {
        const stored=await this.storage.get(TOKEN_KEY);
        if(!validTokenRecord(stored)) throw new Error('missing token');
        const token=await openDailyToken(stored,this.env,nowMs);
        if(!token) throw new Error('expired token');
        const reservation=await this.reserveReadOnlyQuote(tickId,nowMs,'OPTION_PAIR');
        if(!reservation.allowed) throw new Error('rate guard blocked');
        const client=createReadOnlyKite({apiKey:this.env.KITE_API_KEY,accessToken:token});
        let quotes;
        try { quotes=await client.optionPair(pair.CE.symbol,pair.PE.symbol); }
        catch(error) {
          await this.recordReadOnlyQuoteFailure(tickId,Date.now(),error).catch(()=>{});
          throw error;
        }
        const evidence=validatePairEvidence({pair,quotes,observedAtMs:Date.now()});
        await this.storage.transaction(async txn=>{
          const old=await txn.get(READONLY_OPTION_STATE_KEY);
          await txn.put(READONLY_OPTION_STATE_KEY,finishOptionSnapshot(old,{tickId,evidence}));
          if(this.readonlyPaperEnabled) {
            // Atomic double-entry paper debits, exits and pending outbox;
            // never use the separate synthetic test portfolio state.
            const [oldBridge,oldLedger]=await Promise.all([
              txn.get(READONLY_PAPER_BRIDGE_KEY),txn.get(READONLY_PAPER_LEDGER_KEY)]);
            const currentBridge=oldBridge??newReadOnlyBridge();
            const currentLedger=oldLedger??newPaperLedger(nowMs);
            const advanced=advanceReadOnlyPaperTurn(currentBridge,currentLedger,{
              tickId,observedAtMs:Date.now(),evidence});
            if(advanced.state!==oldBridge)
              await txn.put(READONLY_PAPER_BRIDGE_KEY,advanced.state);
            if(advanced.ledger!==oldLedger)
              await txn.put(READONLY_PAPER_LEDGER_KEY,advanced.ledger);
          }
        });
        report.status='OPTION_OBSERVED';
      }
    } catch {
      if(claimed) {
        try {await this.storage.transaction(async txn=>{
          const old=await txn.get(READONLY_OPTION_STATE_KEY);
          await txn.put(READONLY_OPTION_STATE_KEY,noteOptionFailure(old,{tickId}));
        });} catch { /* fail closed without rewriting a newer observation */ }
      }
    }
    try {await this.storage.put(MARKET_KEY,report);}
    catch {return {status:'BLOCKED_OBSERVATION_STORAGE'};}
    return report;
  }
}

function validTokenRecord(record) {
  return record && record.schema === 1 && Number.isSafeInteger(record.signedAt) &&
    Number.isSafeInteger(record.expiresAtMs) &&
    record.expiresAtMs === expiryForSignedSecond(record.signedAt) &&
    typeof record.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(record.fingerprint) && Array.isArray(record.nonces) &&
    record.nonces.length <= RETAINED_NONCES &&
    record.nonces.every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)) &&
    typeof record.iv === 'string' && typeof record.ciphertext === 'string';
}

function validMarketObservation(value) {
  return value && value.schema === 1 && typeof value.tickId === 'string' &&
    Number.isSafeInteger(value.observedAtMs) &&
    ['BLOCKED_MARKET_DATA', 'BLOCKED_OBSERVATION_STORAGE',
      'QUOTE_OBSERVED', 'HISTORY_OBSERVED','OPTION_OBSERVED',
      'OPTION_BLOCKED','OPTION_NO_MASTER'].includes(value.status);
}
