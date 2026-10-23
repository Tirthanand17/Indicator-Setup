// Phase 49: Cloudflare Free edge bridge. NO broker requests, NO trades, NO alerts.
// Compatible with the Python token_sender HMAC: timestamp+"\n"+nonce+"\n"+raw JSON.
const encoder = new TextEncoder();
const MAX_BODY = 2048;
const TWO_DAYS = 2 * 86400;
const RESPONSE_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

function reply(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: RESPONSE_HEADERS });
}
const fail = (status = 503) => reply(status, { status: "UNAVAILABLE" });
function configReady(env) {
  return !!(env.DB && typeof env.RELAY_HMAC_KEY === "string" && env.RELAY_HMAC_KEY.length >= 32 &&
    typeof env.KITE_API_KEY === "string" && env.KITE_API_KEY.length > 0 &&
    typeof env.EDGE_AES_KEY === "string");
}
function decodeHex(str) {
  if (typeof str !== "string" || !/^[0-9a-f]{64}$/i.test(str)) return null;
  return Uint8Array.from(str.match(/../g), x => parseInt(x, 16));
}
export function nextExpiryUtc(nowMs) {
  // Kite token boundary is 06:00 Asia/Kolkata = 00:30 UTC next local day.
  const offset = 330 * 60000;
  const day = Math.floor((nowMs + offset) / 86400000);
  const localTodayBoundary = day * 86400000 + 6 * 3600000 - offset;
  return nowMs >= localTodayBoundary ? localTodayBoundary + 86400000 : localTodayBoundary;
}
export function scheduledPhase(nowMs) {
  const ist = new Date(nowMs + 330 * 60000);
  const day = ist.getUTCDay();
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return day >= 1 && day <= 5 && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30
    ? "MARKET_TIME_UNVERIFIED_CALENDAR" : "OUTSIDE_TIME_WINDOW";
}
async function verifyHmac(env, timestamp, nonce, suppliedHex, body) {
  if (!/^\d{10,11}$/.test(timestamp || "") ||
      !/^[0-9a-f]{40}$/i.test(nonce || "") ||
      !decodeHex(suppliedHex)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > 90) return false;
  const input = new Uint8Array(encoder.encode(timestamp + "\n" + nonce + "\n").length + body.length);
  const prefix = encoder.encode(timestamp + "\n" + nonce + "\n");
  input.set(prefix);
  input.set(body, prefix.length);
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.RELAY_HMAC_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, decodeHex(suppliedHex), input);
}
function decodeBase64(s) {
  if (typeof s !== "string" || !/^[a-zA-Z0-9+/]{43}=$/.test(s)) throw new Error("bad encryption key");
  const binary = atob(s);
  if (binary.length !== 32) throw new Error("bad encryption key length");
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function base64(bytes) {
  // Never used in URL, and never returned to callers.
  let out = "";
  for (const x of bytes) out += String.fromCharCode(x);
  return btoa(out);
}
async function encryptToken(token, env) {
  const key = await crypto.subtle.importKey("raw", decodeBase64(env.EDGE_AES_KEY), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(token));
  return { iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) };
}
function parseRelay(raw, env) {
  let body;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { return null; }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).sort().join(",") !== "access_token,api_key" ||
      body.api_key !== env.KITE_API_KEY ||
      typeof body.access_token !== "string" || body.access_token.length < 20 ||
      body.access_token.length > 1024 || !/^[\x21-\x7e]+$/.test(body.access_token)) return null;
  return body;
}
async function relay(request, env) {
  if (env.TOKEN_RELAY_ENABLED !== "true") return fail(401);
  if (!configReady(env)) return fail();
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return fail(415);
  const length = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(length) || length > MAX_BODY) return fail(413);
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.length === 0 || raw.length > MAX_BODY) return fail(413);
  const ts = request.headers.get("x-relay-timestamp");
  const nonce = request.headers.get("x-relay-nonce");
  const signature = request.headers.get("x-relay-signature");
  if (!await verifyHmac(env, ts, nonce, signature, raw)) return fail(401);
  const data = parseRelay(raw, env);
  if (!data) return fail(400);
  const cryptoState = await encryptToken(data.access_token, env);
  const at = Number(ts);
  const expires = nextExpiryUtc(Date.now());
  if (expires <= Date.now()) return fail();
  // Persist a replay marker before the token; D1 unique index prevents replays.
  // The conditional upsert prevents delayed older valid credentials replacing
  // newer accepted tokens. A replay can consume its nonce but NEVER change vault.
  const nonceResult = await env.DB.prepare(
    "INSERT INTO relay_nonces(nonce, seen_at) VALUES (?, ?) ON CONFLICT(nonce) DO NOTHING"
  ).bind(nonce, Math.floor(Date.now() / 1000)).run();
  if (!nonceResult.meta || nonceResult.meta.changes !== 1) return fail(409);
  const write = await env.DB.prepare(
    "INSERT INTO token_vault(id, iv, cipher, relay_ts, expires_ms) VALUES (1, ?, ?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET iv=excluded.iv, cipher=excluded.cipher, " +
    "relay_ts=excluded.relay_ts, expires_ms=excluded.expires_ms " +
    "WHERE excluded.relay_ts > token_vault.relay_ts"
  ).bind(cryptoState.iv, cryptoState.ciphertext, at, expires).run();
  if (!write.meta || write.meta.changes !== 1) return fail(409);
  return reply(200, { status: "TOKEN_ACCEPTED" });
}
async function handle(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/status" && request.method === "GET")
    return reply(200, { status: "UP", mode: "INERT_RESEARCH_ONLY", broker_orders: false,
      paper_trading_enabled: false, live_data: false });
  if (url.pathname === "/internal/token" && request.method === "POST") return relay(request, env);
  return reply(404, { status: "NOT_FOUND" });
}
export default {
  async fetch(request, env) {
    try { return await handle(request, env); } catch { return fail(); } // no token or provider error disclosure
  },
  async scheduled(event, env) {
    // Safe by design: only schedule heartbeat, no Kite fetch or Telegram calls.
    if (!env.DB) return;
    try {
      const now = Number(event.scheduledTime) || Date.now();
      const phase = scheduledPhase(now);
      await env.DB.prepare(
        "INSERT INTO edge_heartbeat(id, timestamp_ms, phase) VALUES (1, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET timestamp_ms=excluded.timestamp_ms, phase=excluded.phase"
      ).bind(now, phase).run();
      // Bounded cleanup; no read of token, no HTTP calls, no synthetic fills.
      await env.DB.prepare("DELETE FROM relay_nonces WHERE seen_at < ?")
        .bind(Math.floor(now / 1000) - TWO_DAYS).run();
    } catch {
      // Cloudflare Cron logs must be inspected; no invented successful heartbeat.
      throw new Error("EDGE_HEARTBEAT_WRITE_FAILED");
    }
  }
};
