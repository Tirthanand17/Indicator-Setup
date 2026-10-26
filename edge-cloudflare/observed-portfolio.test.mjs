import test from 'node:test';
import assert from 'node:assert/strict';
import {newPaperLedger,enterPaperBasket,exitPaperPosition,markPaperUnverifiable} from './paper-ledger.mjs';
import {newReadOnlyBridge} from './readonly-paper-bridge.mjs';
import {captureObservedPortfolio,observedPortfolioMetrics,auditObservedPortfolio} from './observed-portfolio.mjs';
import {privateReadOnlySnapshot} from './readonly-dashboard.mjs';

const AT=Date.parse('2026-10-23T10:00:00+05:30');
const quote=(at,bid=100,extra={})=>({contract:{symbol:'NIFTY26OCT23000CE',kind:'CE',expiry:'2026-10-29',
  token:12345,lotSize:65,strike:23000},bid,ask:bid+0.5,bidQuantity:650,askQuantity:650,updatedAtMs:at-1000,...extra});
const bridge=(at=AT,slot=135)=>({...newReadOnlyBridge(),lastOptionTickId:'2026-10-23:'+slot,lastOptionAtMs:at,totalOptionTicks:slot-134});
const enter=()=>enterPaperBasket(newPaperLedger(AT),{signalId:'observed-entry-001',nowMs:AT,quote:quote(AT)}).ledger;
const capture=(ledger,quotes=[quote(AT)])=>captureObservedPortfolio(undefined,newReadOnlyBridge(),newPaperLedger(AT),bridge(),ledger,quotes);
const project=(ledger,record,at=AT,b=bridge())=>observedPortfolioMetrics(ledger,b,record,at);

test('flat cash is known without invented quotes and has zero net return',()=>{
  const l=newPaperLedger(AT),m=project(l,undefined);
  assert.equal(m.accounts[0].markedEquityRupees,50000);
  assert.equal(m.accounts[1].markedEquityRupees,100000);
  assert.equal(m.accounts[0].unrealizedPnlRupees,0);
  assert.equal(m.accounts[0].profitFactor,null);
  assert.equal(m.accounts[0].profitFactorStatus,'NO_CLOSED_TRADES');
});

test('net liquidation uses adverse BID fill, full quantity and sell fees without double charging entry',()=>{
  const l=enter(),r=capture(l),m=project(l,r);
  // 100 BID * (1 - 8bp) = 99.92; 65 units. SELL fees: 20 brokerage,
  // 2.31 exchange, .01 SEBI, 4.02 GST, 10 STT = 36.34 rupees.
  const t=m.trades.get(l.positions[0].tradeId),a=m.accounts[0];
  assert.equal(t.estimatedExitFillRupees,99.92);
  assert.equal(t.estimatedExitFeeRupees,36.34);
  assert.equal(a.markedEquityRupees,(l.accounts.PAPER_50K.cashPaise+649480-3634)/100);
  assert.equal(a.unrealizedPnlRupees,(649480-3634-l.positions[0].entryDebitPaise)/100);
  assert.equal(t.currentPremiumRupees,100);
  assert.equal(t.quantity,65);assert.equal(t.strike,23000);
  assert.equal(a.markedEquityRupees,50000+a.totalNetPnlRupees);
  assert.equal(m.accounts[1].markedEquityRupees,100000+m.accounts[1].totalNetPnlRupees);
  assert.equal(a.sampledHistoryComplete,true);
  assert.ok(t.netRiskRupees>0);assert.ok(t.netRiskReward>0);
});

test('missing, stale, mismatched and shallow quotes never fabricate open equity',()=>{
  const l=enter();
  for(const quotes of [[],[quote(AT,100,{updatedAtMs:AT-15001})],
    [quote(AT,100,{bidQuantity:64})],
    [quote(AT,100,{contract:{...quote(AT).contract,token:999}})],
    [quote(AT,100,{contract:{...quote(AT).contract,strike:23100}})]]) {
    const r=capture(l,quotes),m=project(l,r);
    assert.equal(m.accounts[0].markedEquityRupees,null);
    assert.equal(m.accounts[0].unrealizedPnlRupees,null);
    assert.equal(m.accounts[0].sampledHistoryComplete,false);
  }
  const r=capture(l);assert.equal(project(l,r,AT+15001).accounts[0].markedEquityRupees,null);
  const shallow=capture(l,[quote(AT,100,{bidQuantity:65})]);
  assert.notEqual(project(l,shallow).accounts[0].markedEquityRupees,null);
  assert.equal(project(l,shallow).accounts[1].markedEquityRupees,null);
});

test('sampled peaks, drawdowns and duplicate idempotency persist across serialization and missing data',()=>{
  const l=enter(),b=bridge(),r=capture(l),b2=bridge(AT+20000,136);
  const high=captureObservedPortfolio(JSON.parse(JSON.stringify(r)),b,l,b2,l,[quote(AT+20000,120)]);
  assert.equal(captureObservedPortfolio(high,b2,l,b2,l,[],AT+20000),high);
  const b3=bridge(AT+40000,137);
  const low=captureObservedPortfolio(high,b2,l,b3,l,[quote(AT+40000,110)]);
  const a=project(l,low,AT+40000,b3).accounts[0];
  assert.ok(a.maxDrawdownRupees>0);assert.equal(a.drawdownRupees,a.maxDrawdownRupees);
  const b4=bridge(AT+60000,138),missing=captureObservedPortfolio(low,b3,l,b4,l,[]);
  const out=project(l,missing,AT+60000,b4).accounts[0];
  assert.equal(out.maxDrawdownRupees,a.maxDrawdownRupees);
  assert.equal(out.markedEquityRupees,null);assert.equal(out.drawdownRupees,null);
  assert.equal(out.sampledHistoryComplete,false);assert.equal(out.missingValuationSamples,1);
  assert.equal(out.recentEquitySamples.at(-1).equityRupees,null);
  const b5=bridge(AT+100000,140);
  const gap=captureObservedPortfolio(low,b3,l,b5,l,[quote(AT+100000,110)]);
  assert.equal(gap.accounts.PAPER_50K.historyComplete,false);
});

test('closed trade statistics reconcile to account cash, after all modeled fees',()=>{
  let l=enter();
  for(const p of l.positions)l=exitPaperPosition(l,{tradeId:p.tradeId,nowMs:AT+20000,quote:quote(AT+20000,170)}).ledger;
  const b=bridge(AT+20000,136),r=captureObservedPortfolio(undefined,bridge(),enter(),b,l,[],AT+20000);
  const m=project(l,r,AT+20000,b),a=m.accounts[0];
  assert.equal(a.closedTrades,1);assert.equal(a.wins,1);assert.equal(a.losses,0);
  assert.equal(a.winRate,100);assert.equal(a.averageWinningTradeRupees,a.realizedNetPnlRupees);
  assert.equal(a.expectancyRupees,a.realizedNetPnlRupees);
  assert.equal(a.profitFactor,null);assert.equal(a.profitFactorStatus,'NO_LOSING_TRADES');
  assert.equal(a.markedEquityRupees,l.accounts.PAPER_50K.cashPaise/100);
  assert.equal(a.markedEquityRupees,50000+a.realizedNetPnlRupees);
  assert.equal(a.grossRealizedBeforeFeesRupees,Number((a.realizedNetPnlRupees+a.incurredFeesRupees).toFixed(2)));
  assert.equal(m.monthly[0].realizedNetPnlRupees,a.realizedNetPnlRupees);
  assert.equal(m.daily[0].realizedNetPnlRupees,a.realizedNetPnlRupees);
});

test('loss statistics, profit factor and missing legacy history remain explicit',()=>{
  let l=enter();for(const p of l.positions)l=exitPaperPosition(l,{tradeId:p.tradeId,nowMs:AT+20000,quote:quote(AT+20000,70)}).ledger;
  const m=project(l,undefined,AT+20000),a=m.accounts[0];
  assert.equal(a.losses,1);assert.equal(a.profitFactor,0);assert.equal(a.profitFactorStatus,'DEFINED');
  assert.equal(a.averageLosingTradeRupees,a.realizedNetPnlRupees);
  assert.equal(a.sampledHistoryComplete,false);assert.equal(a.maxDrawdownRupees,null);
  assert.ok(a.maxRealizedDrawdownRupees>0);
});

test('mixed winners and losers reconcile profit factor, expectancy and independent monthly reports',()=>{
  let l=enter();
  for(const p of l.positions)l=exitPaperPosition(l,{tradeId:p.tradeId,nowMs:AT+20000,quote:quote(AT+20000,170)}).ledger;
  l=enterPaperBasket(l,{signalId:'observed-entry-002',nowMs:AT+40000,quote:quote(AT+40000)}).ledger;
  for(const p of l.positions.filter(p=>p.status==='OPEN'))
    l=exitPaperPosition(l,{tradeId:p.tradeId,nowMs:AT+60000,quote:quote(AT+60000,70)}).ledger;
  const m=project(l,undefined,AT+60000),a=m.accounts[0];
  const own=l.positions.filter(p=>p.accountId===a.accountId);
  assert.equal(a.closedTrades,2);assert.equal(a.winRate,50);
  assert.equal(a.profitFactor,Number((own[0].netPnlPaise/-own[1].netPnlPaise).toFixed(4)));
  assert.equal(a.averageWinningTradeRupees,own[0].netPnlPaise/100);
  assert.equal(a.averageLosingTradeRupees,own[1].netPnlPaise/100);
  assert.equal(a.expectancyRupees,Math.round((own[0].netPnlPaise+own[1].netPnlPaise)/2)/100);
  assert.equal(a.realizedEquityCurve.at(-1).equityRupees,l.accounts.PAPER_50K.cashPaise/100);
  const november=observedPortfolioMetrics(l,bridge(),undefined,AT+60000,'2026-11-02');
  assert.equal(november.monthly.find(m=>m.month==='2026-11'&&m.accountId===a.accountId).closedTrades,0);
  assert.equal(november.daily[0].realizedNetPnlRupees,0);
});

test('recent samples are bounded while lifetime peaks and sample counts persist',()=>{
  const l=enter();let b=bridge(),r=capture(l);
  for(let i=1;i<140;i++) {
    const next=bridge(AT+i*20000,135+i);
    r=captureObservedPortfolio(r,b,l,next,l,[quote(AT+i*20000,i===1?120:100)]);b=next;
  }
  assert.equal(r.accounts.PAPER_50K.samples,140);
  assert.equal(r.accounts.PAPER_50K.recent.length,128);
  assert.ok(r.accounts.PAPER_50K.peakEquityPaise>5000000);
  assert.equal(auditObservedPortfolio(JSON.parse(JSON.stringify(r))),true);
});

test('unverifiable and carried positions have unavailable valuation and no realized wins',()=>{
  const l=enter(),at=Date.parse('2026-10-23T15:26:00+05:30');
  const u=markPaperUnverifiable(l,at).ledger;
  const m=project(u,undefined,at);
  assert.equal(m.healthStatus,'BLOCKED_UNVERIFIABLE_EXIT');
  assert.equal(m.accounts[0].closedTrades,0);assert.equal(m.accounts[0].markedEquityRupees,null);
  const next=project(l,capture(l),AT+86400000);
  assert.equal(next.accounts[0].valuationStatus,'CARRIED_POSITION_UNVERIFIED');
});

test('corrupt, orphaned and rollback metrics fail visibly without hiding verified ledger cash',()=>{
  const l=enter(),r=capture(l),bad=structuredClone(r);bad.marks[0].token++;
  assert.equal(project(l,bad).metricsStatus,'INVALID_OR_ORPHANED_METRICS');
  assert.equal(project(l,bad).accounts[0].markedEquityRupees,null);
  assert.equal(project(l,bad).accounts[0].availableCapitalRupees,l.accounts.PAPER_50K.cashPaise/100);
  assert.throws(()=>captureObservedPortfolio(bad,bridge(),l,bridge(),l,[]));
  assert.throws(()=>project(l,r,AT-1),/CLOCK/);
  const broken=structuredClone(r);broken.accounts.PAPER_50K.recent[0].equityPaise=-1;
  assert.throws(()=>auditObservedPortfolio(broken));
  const altered=structuredClone(l);altered.accounts.PAPER_50K.cashPaise++;
  assert.throws(()=>project(altered,r));
});

test('private projection exposes metrics and costs without instrument tokens or raw quotes',()=>{
  const l=enter(),r=capture(l),out=privateReadOnlySnapshot(bridge(),l,{portfolioMetrics:r,nowMs:AT});
  assert.equal(out.markedToMarket,true);assert.equal(out.accounts[0].valuationStatus,'FRESH_OBSERVED_BID');
  assert.equal(out.trades[0].strike,23000);assert.equal(out.monthly.length,2);
  assert.equal(JSON.stringify(out).includes('12345'),false);
  assert.equal(JSON.stringify(out).includes('bidQuantity'),false);
  assert.equal(out.realOrdersEnabled,false);
});
