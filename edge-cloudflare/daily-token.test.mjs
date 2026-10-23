import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { boundedRelayBody, verifyDailyRelay, expiryForSignedSecond,
  sealDailyToken, openDailyToken, sha256 } from './daily-token.mjs';

const env = { KITE_API_KEY: 'synthetic-api-key',
  TOKEN_RELAY_HMAC_KEY: 'synthetic-hmac-secret-for-offline-signing-123456789',
  TOKEN_VAULT_AES_KEY: randomBytes(32).toString('base64') };
const now = Date.parse('2026-10-23T09:00:00+05:30');
const token = 'SYNTHETIC-ACCESS-TOKEN-NEVER-LIVE-0123456789';

function signedRequest({ at = now, nonce = 'abcdefghijklmnopqrstuvwx1234567890',
  value = token, body, signature, contentType = 'application/json' } = {}) {
  const timestamp = String(Math.floor(at / 1000));
  const data = body ?? JSON.stringify({ api_key: env.KITE_API_KEY, access_token: value });
  const digest = signature ?? createHmac('sha256', env.TOKEN_RELAY_HMAC_KEY)
    .update(`${timestamp}\n${nonce}\n${data}`).digest('hex');
  return new Request('https://unit.invalid/internal/token', { method: 'POST',
    headers: { 'content-type': contentType, 'x-relay-timestamp': timestamp,
      'x-relay-nonce': nonce, 'x-relay-signature': digest }, body: data });
}

test('Python HMAC envelope interoperates with JS verifier; exact expiry 06:00 IST', async () => {
  const accepted = await verifyDailyRelay(signedRequest(), env, now);
  assert.equal(accepted.token, token);
  assert.equal(accepted.signedAt, Math.floor(now / 1000));
  assert.equal(new Date(accepted.expiresAtMs).toISOString(), '2026-10-24T00:30:00.000Z');
  assert.equal(expiryForSignedSecond(Math.floor(Date.parse('2026-10-23T05:59:59+05:30')/1000)),
    Date.parse('2026-10-23T06:00:00+05:30'));
});

test('HMAC sender constraints reject tampered body, wrong identity, skew and expiry', async () => {
  for (const req of [
    signedRequest({signature:'0'.repeat(64)}),
    signedRequest({nonce:'short'}),
    signedRequest({at:now-91_000}),
    signedRequest({at:now+91_000}),
    signedRequest({contentType:'text/plain'}),
    signedRequest({body:JSON.stringify({api_key:'different-key',access_token:token})}),
    signedRequest({body:JSON.stringify({api_key:env.KITE_API_KEY,access_token:token,orders:true})}),
    signedRequest({value:'bad token with whitespace'}),
    signedRequest({body:'{not json'}),
    signedRequest({body:'x'.repeat(2049)}),
  ]) await assert.rejects(verifyDailyRelay(req,env,now), /rejected/i);
  const before = Date.parse('2026-10-23T05:59:59+05:30');
  await assert.rejects(verifyDailyRelay(signedRequest({at:before}), env, before+1500), /rejected/i);
});

test('bounded reader rejects oversized chunk even when Content-Length omitted', async () => {
  const req = new Request('https://unit.invalid/internal/token', {method:'POST',
    headers:{'content-type':'application/json'},body:'A'.repeat(2050)});
  await assert.rejects(boundedRelayBody(req), /rejected/);
});

test('AES-GCM ciphertext seals bearer, round-trips and fails closed on wrong key, expiry and tamper', async () => {
  const meta={schema:1,signedAt:Math.floor(now/1000),fingerprint:await sha256(token),
    expiresAtMs:expiryForSignedSecond(Math.floor(now/1000))};
  const sealed = await sealDailyToken(token,env,meta);
  assert.ok(!JSON.stringify(sealed).includes(token));
  const record = {...meta,...sealed};
  assert.equal(await openDailyToken(record,env,now),token);
  assert.equal(await openDailyToken(record,env,record.expiresAtMs),null);
  assert.equal(await openDailyToken(record,{...env,TOKEN_VAULT_AES_KEY:randomBytes(32).toString('base64')},now),null);
  assert.equal(await openDailyToken({...record,iv:'AAAAAA'},env,now),null);
  assert.equal(await openDailyToken({...record,fingerprint:'0'.repeat(64)},env,now),null);
  assert.equal(await openDailyToken({...record,expiresAtMs:record.expiresAtMs+86_400_000},env,now),null);
  await assert.rejects(sealDailyToken(token,{...env,TOKEN_VAULT_AES_KEY:'bad'},meta), /rejected/);
});

export { signedRequest, env, now, token };
