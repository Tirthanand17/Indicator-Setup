/** Phase23: complete, authenticated offline research archive (not a token vault).
 * Export is read-only. Restore is internal/test-only and refuses nonempty state.
 * No trading, outbound network, scheduler bootstrap or Telegram dispatch.
 */
import { PAPER_LEDGER_KEY, auditPaperLedger } from './paper-ledger.mjs';
import { SYNTHETIC_SESSION_KEY, auditSyntheticSession } from './synthetic-session.mjs';
import { PORTFOLIO_MARKS_KEY, auditPortfolioMarks } from './portfolio-valuation.mjs';

export const ARCHIVE_SCHEMA = 1;
export const MAX_ARCHIVE_BYTES = 4_000_000;
export const PAPER_CAPACITY = Object.freeze({ positions: 512, rejections: 1024,
  outbox: 1024, recentSyntheticEvents: 128 });
const coder = new TextEncoder();
const fail = reason => { throw new Error(`PAPER_ARCHIVE_${reason}`); };
const safeDate = x => Number.isSafeInteger(x) && x > 0;
const validKey = key => typeof key === 'string' && key.length >= 32 &&
  key.length <= 256 && new Set(key).size >= 8;
const keysExactly = (value, expected) => value && !Array.isArray(value) &&
  typeof value === 'object' && Object.keys(value).sort().join(',') === expected.slice().sort().join(',');
const bytes = obj => coder.encode(JSON.stringify(obj));
const base64url = binary => btoa(String.fromCharCode(...binary))
  .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function signingKey(secret) {
  if (!validKey(secret)) fail('INVALID_HMAC_KEY');
  return crypto.subtle.importKey('raw', coder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Reject partial/corrupt journals before computing any export or capacity row. */
export function auditPaperArchiveState(ledger, session = null, marks = null) {
  auditPaperLedger(ledger);
  if (session !== null) auditSyntheticSession(session);
  if (marks !== null) {
    if (session === null) fail('ORPHAN_QUOTE_MARKS');
    auditPortfolioMarks(marks, session);
  }
  return true;
}

/** Capacity warning is separate from data deletion: a full ledger HALTS.
 * Synthetic decision events are already a last-128 ring, NOT all history.
 */
export function paperArchiveCapacity(ledger, session = null, marks = null) {
  auditPaperArchiveState(ledger, session, marks);
  const usages = {
    positions: ledger.positions.length, rejections: ledger.rejections.length,
    outbox: ledger.outbox.length,
    recentSyntheticEvents: session?.events.length ?? 0,
  };
  const journalRows = Object.entries(PAPER_CAPACITY).map(([kind, limit]) => {
    const used = usages[kind];
    return { kind, used, limit, remaining: limit - used,
      utilizationPercent: Number((100 * used / limit).toFixed(2)),
      status: kind === 'recentSyntheticEvents' ? (used >= limit ? 'ROLLING' : 'OK') :
        used >= limit ? 'AT_LIMIT' :
        used >= Math.ceil(limit * 0.9) ? 'CRITICAL' :
        used >= Math.ceil(limit * 0.75) ? 'WARNING' : 'OK',
      retention: kind === 'recentSyntheticEvents' ? 'LAST_128_ONLY' : 'PRESERVE_ALL_HALT_AT_LIMIT',
    };
  });
  const serializedBytes = bytes({ ledger, session, marks }).byteLength;
  return { schema: ARCHIVE_SCHEMA, paperOnly: true, syntheticOnly: true,
    realOrdersEnabled: false, tokenVaultIncluded: false,
    pendingAlertsDelivered: false, archivedOffHost: false,
    serializedStateBytes: serializedBytes,
    maximumArchiveBytes: MAX_ARCHIVE_BYTES,
    capacityStatus: journalRows.some(r => r.status === 'AT_LIMIT') ? 'AT_LIMIT' :
      journalRows.some(r => r.status === 'CRITICAL') ? 'CRITICAL' :
      journalRows.some(r => r.status === 'WARNING') ? 'WARNING' : 'OK',
    archiveTooLarge: serializedBytes > MAX_ARCHIVE_BYTES,
    journalRows, completeness: {
      paperPositions: 'FULL_TO_CURRENT_HARD_CAP',
      rejections: 'FULL_TO_CURRENT_HARD_CAP',
      pendingOutbox: 'FULL_TO_CURRENT_HARD_CAP',
      syntheticDecisions: 'LAST_128_ONLY',
      credentialVault: 'EXCLUDED', schedulerAlarm: 'EXCLUDED',
    } };
}

/** Exact JSON integrity is authenticated with a distinct HMAC secret.
 * The archive includes the research outbox and must be kept PRIVATE off-host.
 */
export async function makePaperArchive({ ledger, session = null, marks = null,
  createdAtMs, secret } = {}) {
  auditPaperArchiveState(ledger, session, marks);
  if (!safeDate(createdAtMs) || createdAtMs < ledger.lastMutationAtMs) fail('INVALID_ARCHIVE_CLOCK');
  const payload = { format: 'NIFTY_PAPER_RESEARCH_ARCHIVE', schema: ARCHIVE_SCHEMA,
    createdAtMs, paperOnly: true, ledger, session, marks };
  const encoded = bytes(payload);
  if (encoded.byteLength > MAX_ARCHIVE_BYTES) fail('SIZE_LIMIT');
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoded);
  return { payload, auth: { algorithm: 'HMAC-SHA256',
    tag: base64url(new Uint8Array(signature)) } };
}

/** Authenticity is checked BEFORE any archived accounting document is trusted. */
export async function verifyPaperArchive(bundle, secret) {
  if (!keysExactly(bundle, ['payload', 'auth']) ||
    !keysExactly(bundle.auth, ['algorithm', 'tag']) ||
    bundle.auth.algorithm !== 'HMAC-SHA256' ||
    typeof bundle.auth.tag !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(bundle.auth.tag) ||
    !keysExactly(bundle.payload, ['format', 'schema', 'createdAtMs', 'paperOnly',
      'ledger', 'session', 'marks']) ||
    bundle.payload.format !== 'NIFTY_PAPER_RESEARCH_ARCHIVE' ||
    bundle.payload.schema !== ARCHIVE_SCHEMA || bundle.payload.paperOnly !== true ||
    !safeDate(bundle.payload.createdAtMs)) fail('INVALID_ENVELOPE');
  const encoded = bytes(bundle.payload);
  if (encoded.byteLength > MAX_ARCHIVE_BYTES) fail('SIZE_LIMIT');
  const signature = new Uint8Array(32);
  const tag = bundle.auth.tag.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(tag + '=');
  for (let i = 0; i < signature.length; i++) signature[i] = raw.charCodeAt(i);
  if (!await crypto.subtle.verify('HMAC', await signingKey(secret), signature, encoded)) {
    fail('SIGNATURE_MISMATCH');
  }
  const { ledger, session, marks, createdAtMs } = bundle.payload;
  auditPaperArchiveState(ledger, session, marks);
  if (createdAtMs < ledger.lastMutationAtMs) fail('ARCHIVE_CLOCK_ROLLBACK');
  return structuredClone({ ledger, session, marks, createdAtMs });
}

/** Offline-only recovery primitive: no HTTP route calls this method.
 * The caller supplies an isolated transactional storage target; it MUST be
 * empty, and no scheduler, alarm, token or market feed is restored or started.
 */
export async function restorePaperArchiveToEmpty(storage, bundle, secret) {
  const verified = await verifyPaperArchive(bundle, secret);
  if (typeof storage?.transaction !== 'function') fail('INVALID_RESTORE_STORAGE');
  return storage.transaction(async txn => {
    // Even a valid older archive cannot replace an already-running account.
    const guardedKeys = [PAPER_LEDGER_KEY, SYNTHETIC_SESSION_KEY, PORTFOLIO_MARKS_KEY,
      'scheduler-v1', 'daily-token-v1', 'market-observation-v1'];
    const present = await Promise.all(guardedKeys.map(key => txn.get(key)));
    if (present.some(record => record !== undefined)) fail('TARGET_NOT_EMPTY');
    await txn.put(PAPER_LEDGER_KEY, verified.ledger);
    if (verified.session !== null) await txn.put(SYNTHETIC_SESSION_KEY, verified.session);
    if (verified.marks !== null) await txn.put(PORTFOLIO_MARKS_KEY, verified.marks);
    return { status: 'OFFLINE_RESTORED_TO_EMPTY_STORAGE', paperOnly: true,
      entries: verified.ledger.positions.length, alarmRestored: false,
      vaultRestored: false, liveProcessingEnabled: false };
  });
}
