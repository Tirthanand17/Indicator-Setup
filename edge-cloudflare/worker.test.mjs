import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { MarketSession } from './worker.mjs';
import { assessAlarm, NSE_FO_CALENDAR_VERSION } from './alarm-core.mjs';

const KEY = 'SYNTHETIC-ONLY-0123456789-abcdefghijklmnop';
const ist = (day, time) => Date.parse(`${day}T${time}+05:30`);
const OPEN = ist('2026-10-23', '09:15:00');
const request = (path = '/internal/bootstrap', key = KEY, method = 'POST') =>
  new Request('https://unit.invalid' + path, { method, headers: { authorization: 'Bearer ' + key } });

// Model atomic commit/rollback and serialize concurrent transactions. This is
// not Cloudflare runtime evidence; actual workerd/platform verification remains required.
class Storage {
  data = new Map(); alarmAt = null; fail = false; queue = Promise.resolve();
  async get(key) { return structuredClone(this.data.get(key)); }
  transaction(fn) {
    const run = this.queue.then(async () => {
      const data = structuredClone(this.data);
      let alarmAt = this.alarmAt;
      const txn = {
        get: async key => structuredClone(data.get(key)),
        put: async (key, value) => data.set(key, structuredClone(value)),
        setAlarm: async value => { alarmAt = value; },
        deleteAlarm: async () => { alarmAt = null; },
      };
      const result = await fn(txn);
      if (this.fail) throw new Error('synthetic storage quota/commit fault');
      this.data = data; this.alarmAt = alarmAt;
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

function setup(t, now = OPEN - 60_000) {
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(globalThis, 'fetch', () => assert.fail('external I/O forbidden'));
  const storage = new Storage();
  const env = { SCHEDULER_ADMIN_KEY: KEY, OFFLINE_SCHEDULER_ENABLED: 'true' };
  const session = new MarketSession({ storage }, env);
  env.MARKET_SESSION = { idFromName: name => name, get: () => session };
  return { storage, env, session, set: value => { clock = value; },
    state: () => storage.get('scheduler-v1') };
}

test('unauthenticated, wrong methods and disabled requests never touch a DO', async t => {
  const s = setup(t);
  s.env.MARKET_SESSION.get = () => assert.fail('unauthorized DO access');
  for (const req of [request('/internal/bootstrap','wrong'), request('/orders'),
    request('/internal/bootstrap',KEY,'GET')]) assert.equal((await worker.fetch(req,s.env)).status,404);
  s.env.OFFLINE_SCHEDULER_ENABLED='false';
  assert.equal((await worker.fetch(request(),s.env)).status,503);
});

test('authenticated bootstrap is idempotent and rejects token/upload bodies', async t => {
  const s = setup(t);
  assert.equal((await worker.fetch(request(),s.env)).status,200);
  assert.equal(s.storage.alarmAt,OPEN);
  const original = await s.state();
  s.set(OPEN);
  await worker.fetch(request(),s.env);
  assert.deepEqual(await s.state(),original);
  const body = new Request('https://unit.invalid/internal/bootstrap',{
    method:'POST',headers:{authorization:'Bearer '+KEY},body:'synthetic'});
  assert.equal((await s.session.fetch(body)).status,400);
});

test('atomic claims survive restart, duplicates and concurrent callbacks', async t => {
  const s = setup(t);
  await s.session.fetch(request()); s.set(OPEN);
  const answers = await Promise.all([s.session.alarm(),s.session.alarm()]);
  assert.equal(answers.filter(a=>a.shouldPoll).length,1);
  assert.equal((await s.state()).totalClaims,1);
  const restarted = new MarketSession({storage:s.storage},s.env);
  assert.equal((await restarted.alarm()).shouldPoll,false);
  s.set(OPEN+20_000);
  assert.equal((await restarted.alarm()).shouldPoll,true);
  const saved=await s.state();
  assert.equal(saved.totalClaims,2);
  assert.equal(saved.lastClaimedTickId,'2026-10-23:1');
  assert.equal(saved.events.at(-1).observedAtMs,OPEN+20_000);
});

test('failed commit changes neither claim nor alarm; retry commits once', async t => {
  const s=setup(t); await s.session.fetch(request()); s.set(OPEN);
  const before=await s.state(); s.storage.fail=true;
  await assert.rejects(s.session.alarm());
  assert.deepEqual(await s.state(),before); assert.equal(s.storage.alarmAt,OPEN);
  s.storage.fail=false;
  await s.session.alarm(); await s.session.alarm();
  assert.equal((await s.state()).totalClaims,1);
});

test('delayed callback skips stale tick and does not catch up history', async t => {
  const s=setup(t); await s.session.fetch(request()); s.set(OPEN+120_000);
  assert.equal((await s.session.alarm()).status,'SKIP_LATE_ALARM');
  assert.equal((await s.state()).totalClaims,0);
  assert.equal(s.storage.alarmAt,OPEN+140_000);
});

test('clock rollback and corrupt storage stop scheduling without reset', async t => {
  const s=setup(t); await s.session.fetch(request()); s.set(OPEN); await s.session.alarm();
  s.set(OPEN-1);
  assert.equal((await s.session.alarm()).status,'BLOCKED_CLOCK_ROLLBACK');
  assert.equal(s.storage.alarmAt,null);
  await s.session.fetch(request()); assert.equal(s.storage.alarmAt,null);
  s.storage.data.set('scheduler-v1',{secret:'synthetic-corruption'});
  assert.equal((await s.session.alarm()).status,'BLOCKED_CORRUPT_STATE');
  const response=await s.session.fetch(request('/internal/scheduler',KEY,'GET'));
  assert.equal(response.status,503); assert.ok(!(await response.text()).includes('synthetic-corruption'));
});

test('close, weekend, holiday and unsupported year never claim trades', async t => {
  const s=setup(t,ist('2026-10-19','15:30:00'));
  await s.session.fetch(request());
  assert.equal(s.storage.alarmAt,ist('2026-10-21','09:15:00'));
  s.set(ist('2026-10-20','10:00:00')); await s.session.alarm();
  assert.equal((await s.state()).totalClaims,0);
  s.set(ist('2026-10-24','10:00:00')); await s.session.alarm();
  assert.equal(s.storage.alarmAt,ist('2026-10-26','09:15:00'));
  s.set(ist('2027-01-01','10:00:00'));
  assert.equal((await s.session.alarm()).status,'BLOCKED_UNSUPPORTED_YEAR');
  assert.equal(s.storage.alarmAt,null);
});

test('full synthetic session has 1125 unique claims and bounded retained evidence', async t => {
  const s=setup(t); await s.session.fetch(request());
  for(let slot=0;slot<1125;slot++) { s.set(OPEN+slot*20_000); await s.session.alarm(); }
  const saved=await s.state();
  assert.equal(saved.totalClaims,1125); assert.equal(saved.events.length,128);
  assert.equal(s.storage.alarmAt,ist('2026-10-26','09:15:00'));
});

test('local callback budget halts; storage exhaustion cannot advance state', async t => {
  const s=setup(t); await s.session.fetch(request());
  const state=await s.state();state.callbacks=4096;s.storage.data.set('scheduler-v1',state);
  s.set(OPEN);
  assert.equal((await s.session.alarm()).status,'BLOCKED_LOCAL_QUOTA');
  assert.equal(s.storage.alarmAt,null);
  assert.equal((await s.state()).totalClaims,0);
});

test('corrupt dedupe and reverse tick history fail closed', () => {
  for(const id of ['', 'garbage', '2026-02-30:1','2026-10-23:1125','2026-10-24:1']) {
    assert.equal(assessAlarm({observedAtMs:OPEN,scheduledAtMs:OPEN,
      lastClaimedTickId:id,calendarVersion:NSE_FO_CALENDAR_VERSION}).status,'BLOCKED_INVALID_DEDUPE_STATE');
  }
  assert.equal(assessAlarm({observedAtMs:OPEN,scheduledAtMs:OPEN,
    lastClaimedTickId:'2026-10-23:1',calendarVersion:NSE_FO_CALENDAR_VERSION}).status,'BLOCKED_CLOCK_ROLLBACK');
});
