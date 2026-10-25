import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { newPaperLedger,enterPaperBasket,exitPaperPosition } from './paper-ledger.mjs';
import { newReadOnlyBridge } from './readonly-paper-bridge.mjs';
import { privateReadOnlySnapshot } from './readonly-dashboard.mjs';
import { handlePrivateDashboard,issueDashboardSession } from './private-dashboard.mjs';
import worker from './worker.mjs';
import { newPaperDeliveryJournal,claimPaperDelivery,settlePaperDelivery,
  suppressAmbiguousDelivery } from './paper-delivery.mjs';

const KEY='readonly-private-dashboard-2026-AaBbCcDd012345';
const ADMIN='readonly-scheduler-administrator-0123456789-AbCd';
const AT=Date.parse('2026-10-23T10:30:40+05:30');
const quote=(at,bid=100,ask=100.5)=>({
  contract:{symbol:'NIFTY26O2922050CE',kind:'CE',expiry:'2026-10-29',
    token:314159,lotSize:65},bid,ask,bidQuantity:650,
  askQuantity:650,updatedAtMs:at-1000,
});
function fixture() {
  const bridge={...newReadOnlyBridge(),lastOptionTickId:'2026-10-23:227',
    lastOptionAtMs:AT,totalOptionTicks:1,events:[{tickId:'2026-10-23:227',
      observedAtMs:AT,entered:2,exited:0,status:'PAPER_ENTRY'}]};
  let ledger=newPaperLedger(AT);
  ledger=enterPaperBasket(ledger,{signalId:'READONLY:2026-10-23:1730000000000:CE',
    nowMs:AT,quote:quote(AT)}).ledger;
  ledger=exitPaperPosition(ledger,{tradeId:ledger.positions[0].tradeId,
    nowMs:AT+80_000,quote:quote(AT+80_000,170,170.5)}).ledger;
  return {bridge,ledger};
}
const env=()=>({OFFLINE_SCHEDULER_ENABLED:'true',
  OFFLINE_PRIVATE_DASHBOARD_ENABLED:'true',OFFLINE_PAPER_BRIDGE_ENABLED:'true',
  OFFLINE_OPTION_SNAPSHOT_ENABLED:'true',OFFLINE_READONLY_REVIEW_ENABLED:'true',
  READONLY_MARKET_RUNTIME_ENABLED:'true',PAPER_DASHBOARD_VIEW_KEY:KEY,
  SCHEDULER_ADMIN_KEY:ADMIN});
const storage=(bridge,ledger)=>({get:async key=>({
  'readonly-paper-bridge-v1':bridge,'readonly-paper-ledger-v1':ledger,
  'scheduler-v1':{status:'PAPER_ONLY'},
})[key]});
const request=(path,options={})=>new Request(`https://unit.invalid${path}`,options);
const auth=async()=>({cookie:'__Host-paper_session='+await issueDashboardSession(KEY)});

test('read-only projection separates accounts, realized exits and unresolved equity',()=>{
  const {bridge,ledger}=fixture();
  const result=privateReadOnlySnapshot(bridge,ledger,{nowMs:AT+80_000,day:'2026-10-23'});
  assert.equal(result.source,'READONLY_KITE_EVIDENCE_PAPER_ONLY');
  assert.equal(result.totalOptionTicks,1);
  assert.equal(result.totalTrades,2);
  assert.equal(result.accounts[0].closedCount,1);
  assert.equal(result.accounts[1].openCount,1);
  assert.equal(result.accounts[0].markedEquityRupees,null);
  assert.equal(result.accounts[1].unrealizedPnlRupees,null);
  assert.equal(result.daily[0].verifiedExits,1);
  assert.equal(result.daily[1].winRate,null);
  assert.equal(result.trades[0].netPnlRupees,null);
  assert.equal(result.pendingOutboxCount,null);
  assert.equal(result.retainedOutboxCount,3);
  assert.equal(result.deliveryStatus,'DELIVERY_JOURNAL_UNAVAILABLE');
  assert.equal(result.telegramDelivered,false);
  assert.equal(result.evidenceStatus,'STALE_OR_HISTORIC_OBSERVATION');
  assert.equal(JSON.stringify(result).includes('message'),false);
  assert.equal(JSON.stringify(result).includes('314159'),false); // no broker instrument token
});

test('delivery projection uses durable cursor and distinguishes accepted, ambiguous and suppressed',()=>{
  const {bridge,ledger}=fixture();const nowMs=AT+80_000;
  let journal=newPaperDeliveryJournal(nowMs);
  const project=()=>privateReadOnlySnapshot(bridge,ledger,{nowMs,deliveryJournal:journal});
  const claim=()=>{const c=claimPaperDelivery(journal,ledger,nowMs);journal=c.journal;return c.result;};
  const first=claim();
  journal=settlePaperDelivery(journal,ledger,{...first,nowMs,httpStatus:200,
    botResponse:{ok:true,result:{message_id:123}}}).journal;
  assert.equal(project().pendingOutboxCount,2);
  assert.equal(project().delivery.acceptedByBotApi,1);
  const second=claim();
  journal=settlePaperDelivery(journal,ledger,{...second,nowMs,httpStatus:null,botResponse:null}).journal;
  assert.equal(project().pendingOutboxCount,2);
  assert.equal(project().delivery.queued,1);
  assert.equal(project().delivery.blockingState,'AMBIGUOUS_ACK_REQUIRED');
  journal=suppressAmbiguousDelivery(journal,ledger,{eventId:second.eventId,nowMs,
    decision:'OWNER_SUPPRESS_RESEND_ACKNOWLEDGING_UNKNOWN_DELIVERY'}).journal;
  assert.equal(project().pendingOutboxCount,1);
  assert.equal(project().delivery.suppressedUnknown,1);
  const third=claim();
  journal=settlePaperDelivery(journal,ledger,{...third,nowMs,httpStatus:403,
    botResponse:{ok:false,error_code:403}}).journal;
  assert.equal(project().pendingOutboxCount,0);
  assert.equal(project().delivery.rejected,1);
  assert.equal(project().retainedOutboxCount,3);
  assert.equal(project().telegramDelivered,false);
  assert.throws(()=>privateReadOnlySnapshot(bridge,ledger,{nowMs,deliveryJournal:{...journal,nextIndex:0}}));
});

test('read-only dashboard requires private session and every market flag',async()=>{
  const f=fixture();const s=storage(f.bridge,f.ledger);
  assert.equal((await handlePrivateDashboard(request('/paper/api/readonly'),env(),s)).status,404);
  const headers=await auth();
  const page=await handlePrivateDashboard(request('/paper/dashboard',{headers}),env(),s);
  assert.match(await page.text(),/Market-observed paper accounts/);
  const script=await handlePrivateDashboard(request('/paper/assets/readonly.js'),env(),s);
  const scriptText=await script.text();
  assert.doesNotThrow(()=>new Script(scriptText));
  const response=await handlePrivateDashboard(request('/paper/api/readonly?date=2026-10-23&account=PAPER_100K&limit=1',{headers}),env(),s);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.totalTrades,1);
  assert.equal(data.trades[0].accountId,'PAPER_100K');
  assert.equal(data.accounts.length,2);
  assert.equal(data.realOrdersEnabled,false);
  for(const disabled of ['OFFLINE_PAPER_BRIDGE_ENABLED','OFFLINE_OPTION_SNAPSHOT_ENABLED',
    'OFFLINE_READONLY_REVIEW_ENABLED','READONLY_MARKET_RUNTIME_ENABLED',
    'OFFLINE_PRIVATE_DASHBOARD_ENABLED']) {
    const off=env();off[disabled]='false';
    assert.equal((await handlePrivateDashboard(request('/paper/api/readonly',{headers}),off,s)).status,404,disabled);
  }
});

test('read-only query, unsupported methods, orphan/corrupt records fail closed',async()=>{
  const f=fixture();const headers=await auth();const e=env();
  for(const path of ['/paper/api/readonly?date=2027-01-01',
    '/paper/api/readonly?account=ADMIN','/paper/api/readonly?limit=200',
    '/paper/api/readonly?date=2026-10-23&date=2026-10-24']) {
    const result=await handlePrivateDashboard(request(path,{headers}),e,storage(f.bridge,f.ledger));
    assert.ok([404,503].includes(result.status),path);
  }
  assert.equal((await handlePrivateDashboard(request('/paper/api/readonly?key=secret',{headers}),e,
    storage(f.bridge,f.ledger))).status,404);
  assert.equal((await handlePrivateDashboard(request('/paper/api/readonly',{method:'POST',headers,body:'x'}),e,
    storage(f.bridge,f.ledger))).status,404);
  assert.equal((await handlePrivateDashboard(request('/paper/api/readonly',{headers}),e,
    storage(undefined,undefined))).status,503);
  const corrupt=structuredClone(f.ledger);corrupt.accounts.PAPER_50K.cashPaise++;
  assert.equal((await handlePrivateDashboard(request('/paper/api/readonly',{headers}),e,
    storage(f.bridge,corrupt))).status,503);
  assert.throws(()=>privateReadOnlySnapshot(newReadOnlyBridge(),f.ledger,{nowMs:AT}));
});

test('top-level worker does not permit private read-only route when disabled',async()=>{
  const e=env();e.OFFLINE_PRIVATE_DASHBOARD_ENABLED='false';
  e.MARKET_SESSION={idFromName:()=>{throw Error('must not access storage');}};
  assert.equal((await worker.fetch(request('/paper/api/readonly'),e)).status,404);
});
