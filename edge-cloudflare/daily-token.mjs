/** HMAC-authenticated, AES-GCM-sealed daily Kite access token.
 * No environment lookup, storage, network, logging or broker SDK here.
 * Compatible with cloud_alerts.security.signature and token_sender.py.
 */
import {readBoundedBody} from './ingress.mjs';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const DAY_MS = 86_400_000;
const SIX_AM_IST_UTC_MS = 30 * 60_000;

export class RelayRejected extends Error {
  constructor() { super('Token handoff rejected'); }
}

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function sha256(value) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export function expiryForSignedSecond(second) {
  if (!Number.isSafeInteger(second) || second <= 0 || second > 9_999_999_999) throw new RelayRejected();
  return (Math.floor((second * 1000 - SIX_AM_IST_UTC_MS) / DAY_MS) + 1) * DAY_MS + SIX_AM_IST_UTC_MS;
}

export async function boundedRelayBody(request) {
  if (request.headers.get('content-type')?.toLowerCase() !== 'application/json' || !request.body ||
      Number(request.headers.get('content-length') ?? '0') > 2048) throw new RelayRejected();
  try {
    const bytes = await readBoundedBody(request.body, 2048);
    if (bytes.length === 0) throw new RelayRejected();
    return {raw: bytes, body: decoder.decode(bytes)};
  } catch {throw new RelayRejected();}
}

export async function verifyDailyRelay(request, env, nowMs = Date.now()) {
  const key = env.TOKEN_RELAY_HMAC_KEY;
  const apiKey = env.KITE_API_KEY;
  const ts = request.headers.get('x-relay-timestamp');
  const nonce = request.headers.get('x-relay-nonce');
  const signature = request.headers.get('x-relay-signature');
  if (typeof key !== 'string' || key.length < 32 || typeof apiKey !== 'string' ||
      !/^[0-9]{10,11}$/.test(ts ?? '') || !/^[\x21-\x7e]{24,128}$/.test(nonce ?? '') ||
      !/^[a-f0-9]{64}$/.test(signature ?? '')) throw new RelayRejected();
  const second = Number(ts);
  if (!Number.isSafeInteger(second) || Math.abs(nowMs - second * 1000) > 90_000 ||
      nowMs >= expiryForSignedSecond(second)) throw new RelayRejected();
  const { raw, body } = await boundedRelayBody(request);
  const macKey = await crypto.subtle.importKey('raw', encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const prefix = encoder.encode(`${ts}\n${nonce}\n`);
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix); signed.set(raw, prefix.length);
  // Fixed length; crypto.subtle.verify avoids timing-sensitive string compare.
  const sigBytes = new Uint8Array(signature.match(/../g).map(v => parseInt(v, 16)));
  const verified = await crypto.subtle.verify('HMAC', macKey, sigBytes, signed);
  if (!verified) throw new RelayRejected();
  let payload;
  try { payload = JSON.parse(body); } catch { throw new RelayRejected(); }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object' ||
      Object.keys(payload).sort().join(',') !== 'access_token,api_key' ||
      payload.api_key !== apiKey || typeof payload.access_token !== 'string' ||
      payload.access_token.length < 20 || payload.access_token.length > 1024 ||
      !/^[\x21-\x7e]+$/.test(payload.access_token) ||
      /[\r\n]/.test(apiKey) || apiKey.length === 0) throw new RelayRejected();
  return { token: payload.access_token, signedAt: second, expiresAtMs: expiryForSignedSecond(second),
    nonceHash: await sha256(nonce), fingerprint: await sha256(payload.access_token) };
}

async function aesKey(env) {
  const encoded = env.TOKEN_VAULT_AES_KEY;
  if (typeof encoded !== 'string' || !/^[a-zA-Z0-9+/]{43}=$/.test(encoded)) throw new RelayRejected();
  let raw;
  try { raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); }
  catch { throw new RelayRejected(); }
  if (raw.length !== 32 || btoa(String.fromCharCode(...raw)) !== encoded) throw new RelayRejected();
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function tokenAad(meta) {
  if (!meta || !Number.isSafeInteger(meta.signedAt) ||
      meta.expiresAtMs !== expiryForSignedSecond(meta.signedAt) ||
      !/^[a-f0-9]{64}$/.test(meta.fingerprint ?? '')) throw new RelayRejected();
  return encoder.encode(`token-v1:${meta.signedAt}:${meta.expiresAtMs}:${meta.fingerprint}`);
}

export async function sealDailyToken(token, env, meta) {
  const key = await aesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
    additionalData: tokenAad(meta) }, key, encoder.encode(token));
  return { iv: btoa(String.fromCharCode(...iv)), ciphertext: btoa(String.fromCharCode(...new Uint8Array(sealed))) };
}

export async function openDailyToken(record, env, nowMs = Date.now()) {
  if (!record || record.schema !== 1 || !Number.isSafeInteger(record.expiresAtMs) ||
      !Number.isSafeInteger(record.signedAt) || record.signedAt <= 0 ||
      record.signedAt > 9_999_999_999 ||
      record.expiresAtMs !== expiryForSignedSecond(record.signedAt) ||
      nowMs >= record.expiresAtMs || typeof record.iv !== 'string' ||
      typeof record.ciphertext !== 'string') return null;
  try {
    const key = await aesKey(env);
    const token = decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM',
      iv: Uint8Array.from(atob(record.iv), c => c.charCodeAt(0)),
      additionalData: tokenAad(record) }, key,
    Uint8Array.from(atob(record.ciphertext), c => c.charCodeAt(0))));
    if (token.length < 20 || token.length > 1024 || !/^[\x21-\x7e]+$/.test(token) ||
        record.fingerprint !== await sha256(token)) return null;
    return token;
  } catch { return null; }
}
