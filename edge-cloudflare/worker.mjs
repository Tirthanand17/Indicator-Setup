/** Undeployed scheduler implementation. No market data, secrets relay or trading.
 * SQLite-backed DO storage uses its transactional KV interface. No filesystem,
 * timers, external fetch, broker SDK, or constructor alarm scheduling.
 */
import { assessAlarm, validClaimedTickId, NSE_FO_CALENDAR_VERSION } from './alarm-core.mjs';

const STATE_KEY = 'scheduler-v1';
const MAX_DAILY_CALLBACKS = 4096;
const RETAINED_EVENTS = 128;
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
    if (!((path === '/internal/bootstrap' && request.method === 'POST') ||
          (path === '/internal/scheduler' && request.method === 'GET')) ||
        !await authorized(request, env)) return reply({ error: 'Not found' }, 404);
    if (env.OFFLINE_SCHEDULER_ENABLED !== 'true' || !env.MARKET_SESSION) {
      return reply({ status: 'DISABLED', paperOnly: true }, 503);
    }
    const id = env.MARKET_SESSION.idFromName('nifty-paper-session-v1');
    return env.MARKET_SESSION.get(id).fetch(request);
  },
};

export class MarketSession {
  constructor(ctx, env) {
    this.storage = ctx.storage;
    this.env = env;
  }

  async fetch(request) {
    if (!await authorized(request, this.env)) return reply({ error: 'Not found' }, 404);
    if (this.env.OFFLINE_SCHEDULER_ENABLED !== 'true') return reply({ status: 'DISABLED' }, 503);
    const path = new URL(request.url).pathname;
    try {
      if (path === '/internal/scheduler' && request.method === 'GET') {
        const saved = await this.storage.get(STATE_KEY);
        if (saved === undefined) return reply({ status: 'NOT_INITIALIZED', paperOnly: true });
        if (!validState(saved)) return reply({ status: 'BLOCKED_CORRUPT_STATE' }, 503);
        return reply({ ...saved, paperOnly: true, marketRuntimeImplemented: false, realOrdersEnabled: false });
      }
      if (path !== '/internal/bootstrap' || request.method !== 'POST') return reply({ error: 'Not found' }, 404);
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
        paperOnly: true, marketRuntimeImplemented: false, realOrdersEnabled: false });
    } catch {
      return reply({ status: 'BLOCKED_STORAGE_OR_STATE', paperOnly: true }, 503);
    }
  }

  async alarm() {
    // An exception before commit is retried by Cloudflare. No external effects
    // happen inside the transaction or after it, so replay cannot create fills.
    const now = Date.now();
    return this.storage.transaction(async txn => {
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
  }
}
