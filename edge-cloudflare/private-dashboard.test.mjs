import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { newPaperLedger, enterPaperBasket, exitPaperPosition,
  markPaperUnverifiable } from './paper-ledger.mjs';
import { newSyntheticSession } from './synthetic-session.mjs';
import { issueDashboardSession, verifyDashboardSession, privateDashboardSummary,
  privateDashboardTrades, privateDashboardDaily, handlePrivateDashboard } from './private-dashboard.mjs';
import worker from './worker.mjs';

const KEY = 'private-dashboard-view-0123456789-AaBbCcDd';
const ADMIN = 'synthetic-admin-0123456789-AbCdEfGhIj';
const AT = Date.parse('2026-10-23T04:30:00Z');
const quote = (at,bid=100,ask=100.5) => ({
  contract:{symbol:'NIFTY26OCT23000CE',kind:'CE',expiry:'2026-10-29',token:12345,lotSize:65},
  bid,ask,bidQuantity:650,askQuantity:650,updatedAtMs:at-1000,
});
function populatedLedger() {
  let state = newPaperLedger(AT);
  state = enterPaperBasket(state,{signalId:'dashboard-signal-001',quote:quote(AT),nowMs:AT}).ledger;
  state = exitPaperPosition(state,{tradeId:'PAPER_50K:dashboard-signal-001',
    quote:quote(AT+120_000,141,141.5),nowMs:AT+120_000}).ledger;
  return state;
}
const env = () => ({OFFLINE_SCHEDULER_ENABLED:'true',OFFLINE_PAPER_LEDGER_ENABLED:'true',
  OFFLINE_PRIVATE_DASHBOARD_ENABLED:'true',PAPER_DASHBOARD_VIEW_KEY:KEY,
  SCHEDULER_ADMIN_KEY:ADMIN});
function storage(ledger=populatedLedger(),session=newSyntheticSession()) {
  return {get:async key=>({
    'paper-ledger-v1':ledger,'synthetic-session-v1':session,
    'scheduler-v1':{status:'INITIALIZED'},
  })[key]};
}
const req = (path, options={}) => new Request(`https://unit.invalid${path}`,options);
const cookie = async () => '__Host-paper_session='+(await issueDashboardSession(KEY))+'; other=value';

test('signed HttpOnly cookie rejects tampering, expiry, future lifetime and weak secrets',async()=>{
  const original = await issueDashboardSession(KEY,AT);
  assert.equal(await verifyDashboardSession(original,KEY,AT),true);
  assert.equal(await verifyDashboardSession(original,KEY,AT+900_000),false);
  assert.equal(await verifyDashboardSession(original,KEY,AT-1),false);
  assert.equal(await verifyDashboardSession(original,KEY+'x',AT),false);
  assert.equal(await verifyDashboardSession(original.slice(0,-1)+'!',KEY,AT),false);
  assert.equal(await verifyDashboardSession(original,'weak',AT),false);
  assert.equal(await verifyDashboardSession(original,KEY,AT+1),true);
  await assert.rejects(issueDashboardSession('a'.repeat(64),AT));
});

test('account totals are separate and cash is not mislabeled as equity',()=>{
  const result = privateDashboardSummary(populatedLedger(),newSyntheticSession(),'INITIALIZED');
  assert.equal(result.accounts.length,2);
  assert.equal(result.accounts[0].closedCount,1);
  assert.equal(result.accounts[1].openCount,1);
  assert.equal(result.accounts[1].valuationNote,'CASH_ONLY_NOT_EQUITY_NO_VERIFIED_MTM');
  assert.equal(result.markedToMarket,false);
  assert.equal(result.telegramDelivered,false);
  assert.equal(result.realOrdersEnabled,false);
  assert.equal(result.source,'OFFLINE_SYNTHETIC_TEST_ONLY');
  assert.equal(JSON.stringify(result).includes('message'),false);
});

test('trades are paginated, strictly filtered and unsettled P&L stays null',()=>{
  const ledger=populatedLedger();
  const all=privateDashboardTrades(ledger,{limit:'2'});
  assert.equal(all.total,2);
  assert.equal(all.trades[0].accountId,'PAPER_100K');
  assert.equal(all.trades[0].netPnlRupees,null);
  assert.equal(all.trades[1].exitReason,'TARGET');
  assert.equal(privateDashboardTrades(ledger,{account:'PAPER_50K',limit:'1'}).total,1);
  for (const options of [{account:'BOGUS'},{limit:'0'},{limit:'999'},{limit:'1e3'},{limit:'-1'}]) {
    assert.throws(()=>privateDashboardTrades(ledger,options));
  }
});

test('daily report aggregates by IST exit date only, with explicit no-data win rate',()=>{
  const ledger=populatedLedger();
  const day=privateDashboardDaily(ledger,'2026-10-23');
  assert.equal(day.accounts[0].entries,1);
  assert.equal(day.accounts[0].verifiedExits,1);
  assert.equal(day.accounts[0].wins,1);
  assert.equal(day.accounts[0].winRate,100);
  assert.equal(day.accounts[1].entries,1);
  assert.equal(day.accounts[1].verifiedExits,0);
  assert.equal(day.accounts[1].winRate,null);
  const empty=privateDashboardDaily(ledger,'2026-10-22');
  assert.equal(empty.accounts[0].realizedNetPnlRupees,0);
  assert.equal(empty.accounts[0].winRate,null);
  for (const invalid of ['2026-02-30','2027-01-01','2026-10-23x',''])
    assert.throws(()=>privateDashboardDaily(ledger,invalid));
});

test('unverifiable exits are never treated as realized profit',()=>{
  let ledger=newPaperLedger(AT);
  ledger=enterPaperBasket(ledger,{signalId:'unverifiable-signal-001',nowMs:AT,quote:quote(AT)}).ledger;
  ledger=markPaperUnverifiable(ledger,Date.parse('2026-10-23T10:00:00Z')).ledger;
  const day=privateDashboardDaily(ledger,'2026-10-23');
  assert.equal(day.accounts[0].unresolvedEntries,1);
  assert.equal(day.accounts[0].verifiedExits,0);
  assert.equal(day.accounts[0].winRate,null);
  const t=privateDashboardTrades(ledger).trades[0];
  assert.equal(t.netPnlRupees,null);
  assert.equal(t.status,'EXIT_UNVERIFIABLE');
});

test('data-integrity failure rejects all reports with no partial output',()=>{
  const ledger=populatedLedger();
  ledger.accounts.PAPER_50K.cashPaise+=1;
  assert.throws(()=>privateDashboardSummary(ledger));
  assert.throws(()=>privateDashboardTrades(ledger));
  assert.throws(()=>privateDashboardDaily(ledger,'2026-10-23'));
});

test('default-disabled and HTTP/plaintext surfaces reveal no dashboard',async()=>{
  const off=env();off.OFFLINE_PRIVATE_DASHBOARD_ENABLED='false';
  assert.equal((await handlePrivateDashboard(req('/paper/dashboard'),off,storage())).status,404);
  assert.equal((await handlePrivateDashboard(req('/paper/dashboard'),env(),storage())).status,200);
  assert.equal((await handlePrivateDashboard(new Request('http://unit.invalid/paper/dashboard'),env(),storage())).status,503);
  const weak=env();weak.PAPER_DASHBOARD_VIEW_KEY='123';
  assert.equal((await handlePrivateDashboard(req('/paper/dashboard'),weak,storage())).status,503);
  const same=env();same.SCHEDULER_ADMIN_KEY=KEY;
  assert.equal((await handlePrivateDashboard(req('/paper/dashboard'),same,storage())).status,503);
});

test('public login shell contains no data, session or key',async()=>{
  const result=await handlePrivateDashboard(req('/paper/dashboard'),env(),storage());
  const body=await result.text();
  assert.match(body,/Private paper dashboard/);
  assert.doesNotMatch(body,/dashboard-signal-001|SYNTHETIC-ONLY-0123456789|PAPER_50K:/);
  assert.equal(result.headers.get('Cache-Control'),'no-store, private');
  assert.match(result.headers.get('Content-Security-Policy'),/default-src 'none'/);
  assert.equal(result.headers.get('X-Frame-Options'),'DENY');
  assert.equal(result.headers.get('Referrer-Policy'),'no-referrer');
});

test('login key only goes in a bounded form body and is never echoed or stored',async()=>{
  const post=(body,headers={'content-type':'application/x-www-form-urlencoded'})=>
    handlePrivateDashboard(req('/paper/login',{method:'POST',headers,body}),env(),storage());
  const missing=await post('key=wrong');assert.equal(missing.status,401);
  assert.equal((await missing.text()).includes(KEY),false);
  assert.equal((await post('key='+encodeURIComponent(KEY)+'&extra=no')).status,401);
  assert.equal((await post('key='+encodeURIComponent(KEY),{'content-type':'application/json'})).status,401);
  assert.equal((await post('key='+encodeURIComponent(KEY)+'&padding='+'x'.repeat(2048))).status,401);
  assert.equal((await post('key='+encodeURIComponent(KEY),{'content-type':'application/x-www-form-urlencoded','origin':'https://evil.invalid'})).status,404);
  const signed=await post('key='+encodeURIComponent(KEY));
  assert.equal(signed.status,303);
  assert.equal(signed.headers.get('Location'),'/paper/dashboard');
  assert.match(signed.headers.get('Set-Cookie'),/^__Host-paper_session=/);
  assert.match(signed.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);
  assert.equal(signed.headers.get('Set-Cookie').includes(KEY),false);
});

test('private GET APIs require cookie, validate queries, and never expose outbox messages',async()=>{
  const s=storage();const e=env();
  for (const path of ['/paper/api/summary','/paper/api/trades','/paper/api/daily',
    '/paper/api/portfolio'])
    assert.equal((await handlePrivateDashboard(req(path),e,s)).status,404);
  const headers={cookie:await cookie()};
  const summary=await handlePrivateDashboard(req('/paper/api/summary',{headers}),e,s);
  assert.equal(summary.status,200);
  const data=await summary.json();
  assert.equal(data.status,'READY');
  assert.equal(JSON.stringify(data).includes('message'),false);
  const portfolio=await handlePrivateDashboard(req('/paper/api/portfolio',{headers}),e,s);
  assert.equal(portfolio.status,200);
  const capital=await portfolio.json();
  assert.equal(capital.source,'OFFLINE_SYNTHETIC_TEST_ONLY');
  assert.equal(capital.accounts[0].valuationStatus,'FLAT_CASH');
  assert.equal(capital.accounts[1].valuationStatus,'MISSING_SYNTHETIC_MARK');
  assert.equal(capital.accounts[1].indicativeEquityRupees,null);
  assert.equal(capital.accounts[1].availableCashPaise,safeCash());
  assert.equal(JSON.stringify(capital).includes('message'),false);
  const history=await handlePrivateDashboard(req('/paper/api/trades?account=PAPER_100K&limit=1',{headers}),e,s);
  assert.equal((await history.json()).trades.length,1);
  const daily=await handlePrivateDashboard(req('/paper/api/daily?date=2026-10-23',{headers}),e,s);
  assert.equal((await daily.json()).accounts[0].wins,1);
  assert.equal((await handlePrivateDashboard(req('/paper/api/trades?limit=200',{headers}),e,s)).status,503);
  assert.equal((await handlePrivateDashboard(req('/paper/api/daily?date=2027-01-01',{headers}),e,s)).status,503);
  assert.equal((await handlePrivateDashboard(req('/paper/api/trades?hack=true',{headers}),e,s)).status,404);
  assert.equal((await handlePrivateDashboard(req('/paper/api/trades?limit=2&limit=3',{headers}),e,s)).status,404);
  assert.equal((await handlePrivateDashboard(req('/paper/api/summary?unused=true',{headers}),e,s)).status,404);
  assert.equal((await handlePrivateDashboard(req('/paper/api/portfolio?unused=true',{headers}),e,s)).status,404);
  assert.equal((await handlePrivateDashboard(req('/paper/api/portfolio',{method:'POST',headers,body:'x'}),e,s)).status,404);
  assert.equal((await handlePrivateDashboard(req('/paper/api/summary',{method:'POST',headers,body:'x'}),e,s)).status,404);
});

function safeCash() { return populatedLedger().accounts.PAPER_100K.cashPaise; }

test('invalid synthetic marks fail closed on valuation but do not leak partial holdings',async()=>{
  const headers={cookie:await cookie()};
  const s=storage();
  const original=s.get;
  s.get=async key=>key==='synthetic-portfolio-marks-v1'?{schema:999}:original(key);
  const result=await handlePrivateDashboard(req('/paper/api/portfolio',{headers}),env(),s);
  assert.equal(result.status,503);
  assert.deepEqual(await result.json(),{status:'BLOCKED_INVALID_REPORT_STATE_OR_QUERY',paperOnly:true});
});

test('corrupt stored paper ledger fails closed on authenticated GET',async()=>{
  const bad=populatedLedger();bad.accounts.PAPER_50K.cashPaise=-1;
  const headers={cookie:await cookie()};
  assert.equal((await handlePrivateDashboard(req('/paper/api/summary',{headers}),env(),storage(bad))).status,503);
  assert.equal((await handlePrivateDashboard(req('/paper/api/trades',{headers}),env(),storage(bad))).status,503);
});

test('logout clears cookie; assets are inert and secure; methods restricted',async()=>{
  const headers={cookie:await cookie()};
  const logout=await handlePrivateDashboard(req('/paper/logout',{method:'POST',headers}),env(),storage());
  assert.equal(logout.status,303);
  assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.equal((await handlePrivateDashboard(req('/paper/logout',{method:'POST',headers:{...headers,origin:'https://evil.invalid'}}),env(),storage())).status,404);
  const script=await handlePrivateDashboard(req('/paper/assets/dashboard.js'),env(),storage());
  assert.equal(script.headers.get('Content-Type'),'text/javascript; charset=utf-8');
  const js=await script.text();
  assert.doesNotThrow(()=>new Script(js));
  assert.equal(js.includes(KEY),false);
  assert.match(js,/\/paper\/api\/portfolio/);
  assert.equal((await handlePrivateDashboard(req('/paper/assets/dashboard.css'),env(),storage())).headers.get('Content-Type'),'text/css; charset=utf-8');
  assert.equal((await handlePrivateDashboard(req('/paper/assets/dashboard.js',{method:'POST',body:'x'}),env(),storage())).status,404);
  assert.equal((await handlePrivateDashboard(req('/paper/unknown'),env(),storage())).status,404);
});

test('top-level worker routes disabled and unauthorized paths before Durable Object access',async()=>{
  const off=env();off.MARKET_SESSION={idFromName:()=>{throw Error('no access')},get:()=>{throw Error('no access')}};
  off.OFFLINE_PRIVATE_DASHBOARD_ENABLED='false';
  assert.equal((await worker.fetch(req('/paper/dashboard'),off)).status,404);
  assert.equal((await worker.fetch(req('/paper/api/summary'),off)).status,404);
});
