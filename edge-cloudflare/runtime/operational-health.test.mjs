import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {fixture,AT} from '../test-support/observed-archive-fixture.mjs';
import {sealDailyToken,expiryForSignedSecond,sha256} from '../daily-token.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const view='synthetic-health-view-only-0123456789-AbCd',admin='synthetic-health-owner-admin-0123456789-AbCd';
const endpoint='https://unit.invalid/internal/operations',headers={authorization:'Bearer '+view};
const options=(persist,extra={})=>({modules:true,scriptPath:path.join(root,'runtime/harness.mjs'),modulesRoot:root,
  compatibilityDate:'2026-07-30',durableObjects:{MARKET_SESSION:{className:'TestSession',useSQLite:true}},durableObjectsPersist:persist,
  bindings:{OPS_HEALTH_VIEW_KEY:view,SCHEDULER_ADMIN_KEY:admin,OFFLINE_SCHEDULER_ENABLED:'true',
    OFFLINE_OPERATIONAL_HEALTH_ENABLED:'true',READONLY_MARKET_RUNTIME_ENABLED:'true',...extra},
  outboundService:()=>{throw Error('Health inspection must never contact providers');}});
const stub=async mf=>{const ns=await mf.getDurableObjectNamespace('MARKET_SESSION');return ns.get(ns.idFromName('nifty-paper-session-v1'));};
const post=(s,path,data)=>s.fetch('https://unit.invalid'+path,{method:'POST',body:JSON.stringify(data)});
const state=s=>s.fetch('https://unit.invalid/test/archive/state').then(r=>r.json());

test('native health inspection exposes heartbeat/token/quota conditions with read-only credentials and survives restart without mutations',async()=>{
  const persist=await mkdtemp(path.join(os.tmpdir(),'operations-health-'));let mf=new Miniflare(options(persist));
  try {
    let s=await stub(mf);const book=fixture();book.pacing={...book.pacing,count:1013,authBlocked:true};
    await post(s,'/test/archive/seed',{state:book,nowMs:AT+180000});const before=await state(s);
    assert.equal((await mf.dispatchFetch(endpoint)).status,404);
    assert.equal((await mf.dispatchFetch(endpoint,{headers:{authorization:'Bearer '+admin}})).status,404);
    assert.equal((await mf.dispatchFetch('https://unit.invalid/internal/bootstrap',{method:'POST',headers})).status,404);
    const response=await mf.dispatchFetch(endpoint,{headers});assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');const report=await response.json();
    const codes=report.issues.map(i=>i.code);
    for(const code of ['TOKEN_MISSING','HEARTBEAT_STALE','ALARM_MISSING','MARKET_STALE','QUOTE_BUDGET_PRESSURE','AUTH_BLOCKED'])assert.ok(codes.includes(code),code);
    assert.equal(report.providerAuthenticationVerified,false);assert.equal(report.cloudUsageMeasured,false);
    assert.deepEqual(await state(s),before);
    await mf.dispose();mf=new Miniflare(options(persist));s=await stub(mf);
    await post(s,'/test/pipeline/clock',{nowMs:AT+180000});
    assert.deepEqual(await (await mf.dispatchFetch(endpoint,{headers})).json(),report);
    assert.deepEqual(await state(s),before);
  }finally{await mf.dispose();}
});

test('native health validates sealed token handoff locally and never exposes ciphertext, token or provider credentials',async()=>{
  const env={TOKEN_VAULT_AES_KEY:randomBytes(32).toString('base64')};
  const mf=new Miniflare(options(await mkdtemp(path.join(os.tmpdir(),'operations-token-health-')),env));
  try {
    const s=await stub(mf),token='SYNTHETIC-HEALTH-TOKEN-NEVER-SENT-0123456789';
    const meta={signedAt:Math.floor(AT/1000),expiresAtMs:expiryForSignedSecond(Math.floor(AT/1000)),fingerprint:await sha256(token)};
    const record={schema:1,...meta,nonces:[],...await sealDailyToken(token,env,meta)};
    await post(s,'/test/archive/seed',{state:fixture(),nowMs:AT+30000,extra:{key:'daily-token-v1',value:record}});
    const before=await state(s),report=await (await mf.dispatchFetch(endpoint,{headers})).json();
    assert.equal(report.tokenStatus,'HANDOFF_DECRYPTABLE');
    for(const secret of [token,record.iv,record.ciphertext,record.fingerprint,env.TOKEN_VAULT_AES_KEY])assert.equal(JSON.stringify(report).includes(secret),false);
    assert.deepEqual(await state(s),before);
    const futureMeta={signedAt:meta.signedAt+3600,expiresAtMs:expiryForSignedSecond(meta.signedAt+3600),fingerprint:meta.fingerprint};
    const future={schema:1,...futureMeta,nonces:[],...await sealDailyToken(token,env,futureMeta)};
    for(const bad of [{...record,iv:'invalid-base64'}, {...record,signedAt:Number.MAX_SAFE_INTEGER},future]) {
      await post(s,'/test/archive/seed',{nowMs:AT+30000,extra:{key:'daily-token-v1',value:bad}});
      const response=await mf.dispatchFetch(endpoint,{headers});assert.equal(response.status,200);
      const invalid=await response.json();assert.equal(invalid.tokenStatus,'INVALID');
      assert.ok(invalid.issues.some(i=>i.code==='TOKEN_INVALID'));
    }
  }finally{await mf.dispose();}
});
