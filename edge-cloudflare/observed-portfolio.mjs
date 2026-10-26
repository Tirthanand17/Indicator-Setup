/** Observed-option paper net liquidation and sampled drawdown, never broker equity. */
import {auditPaperLedger,checkQuote,moneyScaled,paperPositionActive} from './paper-ledger.mjs';
import {auditReadOnlyBridge} from './readonly-paper-bridge.mjs';
import {estimateLeg} from './strategy-core.mjs';
import {validClaimedTickId} from './alarm-core.mjs';

export const OBSERVED_PORTFOLIO_KEY='readonly-portfolio-metrics-v1';
const SOURCE='READONLY_KITE_EVIDENCE_PAPER_ONLY',IDS=['PAPER_50K','PAPER_100K'];
const fail=code=>{throw Error('OBSERVED_PORTFOLIO_'+code);};
const integer=Number.isSafeInteger;
const positive=n=>integer(n)&&n>0;
const day=ms=>new Date(ms+330*60_000).toISOString().slice(0,10);
const rs=n=>n===null?null:Number((n/100).toFixed(2));
const pct=(n,d)=>Number((100*n/d).toFixed(4));
const sum=values=>values.reduce((a,b)=>{const n=a+b;if(!integer(n))fail('UNSAFE_MONEY');return n;},0);
const average=(n,count)=>count?rs(Math.sign(n)*Math.floor((Math.abs(n)+count/2)/count)):null;
const same=(c,p)=>c.symbol===p.symbol&&c.token===p.token&&c.kind===p.kind&&
  c.expiry===p.expiry&&c.lotSize===p.lotSize&&(p.strike===undefined||p.strike===c.strike);
const recordMatches=(r,b,l)=>r.lastTickId===b.lastOptionTickId&&r.bridgeObservedAtMs===b.lastOptionAtMs&&
  r.ledgerMutationAtMs===l.lastMutationAtMs&&r.positionCount===l.positions.length&&
  r.rejectionCount===l.rejections.length&&r.outboxCount===l.outbox.length;

function ownerAdjustmentStatistics(ledger,accountId,filter=()=>true) {
  const rows=ledger.positions.filter(p=>p.accountId===accountId&&p.status==='EXIT_WRITTEN_OFF'&&filter(p));
  const debit=sum(rows.map(p=>p.entryDebitPaise));
  return {ownerWriteOffCount:rows.length,ownerWriteOffDebitRupees:rs(debit),ownerAdjustmentPnlRupees:rs(-debit)};
}
function accountingHistory(ledger,accountId) {
  const events=ledger.positions.filter(p=>p.accountId===accountId&&['CLOSED','EXIT_WRITTEN_OFF'].includes(p.status))
    .map(p=>({at:p.status==='CLOSED'?p.exitAtMs:p.ownerResolution.atMs,id:p.tradeId,
      pnl:p.status==='CLOSED'?p.netPnlPaise:-p.entryDebitPaise})).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
  let equity=ledger.accounts[accountId].initialPaise,peakPaise=equity,drawdownPaise=0,drawdownPercent=0;
  for(const e of events){equity=sum([equity,e.pnl]);peakPaise=Math.max(peakPaise,equity);
    drawdownPaise=Math.max(drawdownPaise,peakPaise-equity);drawdownPercent=Math.max(drawdownPercent,pct(peakPaise-equity,peakPaise));}
  return {peakPaise,drawdownPaise,drawdownPercent};
}
function closedStatistics(ledger,accountId,filter=()=>true) {
  const positions=ledger.positions.filter(p=>p.accountId===accountId&&p.status==='CLOSED'&&filter(p))
    .sort((a,b)=>a.exitAtMs-b.exitAtMs||a.tradeId.localeCompare(b.tradeId));
  const wins=positions.filter(p=>p.netPnlPaise>0),losses=positions.filter(p=>p.netPnlPaise<0);
  const gain=sum(wins.map(p=>p.netPnlPaise)),loss=-sum(losses.map(p=>p.netPnlPaise)),net=sum(positions.map(p=>p.netPnlPaise));
  const initial=ledger.accounts[accountId].initialPaise;
  let equity=initial,peak=initial,maxDrawdown=0,maxDrawdownPercent=0;
  const curve=[];
  for(const p of positions) {
    equity=sum([equity,p.netPnlPaise]);peak=Math.max(peak,equity);
    maxDrawdown=Math.max(maxDrawdown,peak-equity);
    maxDrawdownPercent=Math.max(maxDrawdownPercent,pct(peak-equity,peak));
    curve.push({atMs:p.exitAtMs,equityRupees:rs(equity),tradeNetPnlRupees:rs(p.netPnlPaise)});
  }
  return {closedTrades:positions.length,wins:wins.length,losses:losses.length,
    breakeven:positions.length-wins.length-losses.length,
    realizedNetPnlRupees:rs(net),winRate:positions.length?pct(wins.length,positions.length):null,
    grossWinningNetPnlRupees:rs(gain),grossLosingNetPnlRupees:rs(loss),
    averageWinningTradeRupees:average(gain,wins.length),averageLosingTradeRupees:average(-loss,losses.length),
    expectancyRupees:average(net,positions.length),profitFactor:loss?Number((gain/loss).toFixed(4)):null,
    profitFactorStatus:!positions.length?'NO_CLOSED_TRADES':!loss?'NO_LOSING_TRADES':'DEFINED',
    realizedReturnPercent:pct(net,initial),realizedPeakEquityRupees:rs(peak),
    maxRealizedDrawdownRupees:rs(maxDrawdown),maxRealizedDrawdownPercent:maxDrawdownPercent,
    realizedEquityCurve:curve};
}

function exitValue(position,bidPaise,onDay) {
  const qty=position.lots*position.lotSize;
  const fill=moneyScaled(bidPaise/100,10_000-position.slippageBps,10_000);
  const fee=estimateLeg(fill/100,qty,'SELL',onDay).total_paise;
  const credit=qty*fill-fee;
  if(!integer(credit)||credit<0)return null;
  return {fillPaise:fill,feePaise:fee,creditPaise:credit};
}

function positionValue(p,marks,nowMs) {
  if(p.status==='EXIT_WRITTEN_OFF')return {status:'OWNER_WRITE_OFF_UNKNOWN_EXIT',value:null,mark:null};
  if(p.status==='EXIT_UNVERIFIABLE')return {status:'BLOCKED_UNVERIFIABLE_EXIT',value:null,mark:null};
  if(p.status==='CLOSED')return {status:'CLOSED',value:null,mark:null};
  if(day(p.entryAtMs)!==day(nowMs))return {status:'CARRIED_POSITION_UNVERIFIED',value:null,mark:null};
  const mark=marks.find(m=>m.tradeId===p.tradeId&&same(m,p));
  if(!mark)return {status:'NO_FRESH_POSITION_MARK',value:null,mark:null};
  if(nowMs-mark.updatedAtMs>15_000||mark.updatedAtMs-nowMs>3000||day(mark.updatedAtMs)!==day(nowMs))
    return {status:'STALE_POSITION_MARK',value:null,mark:null};
  const value=exitValue(p,mark.bidPaise,day(nowMs));
  return {status:value?'FRESH_OBSERVED_BID':'INVALID_NET_EXIT_VALUE',value,mark:value?mark:null};
}

export function auditObservedPortfolio(record) {
  if(!record||record.schema!==1||record.source!==SOURCE||!validClaimedTickId(record.lastTickId)||
    !positive(record.observedAtMs)||!positive(record.bridgeObservedAtMs)||
    record.observedAtMs<record.bridgeObservedAtMs||!positive(record.ledgerMutationAtMs)||
    record.ledgerMutationAtMs>record.observedAtMs||
    !['positionCount','rejectionCount','outboxCount'].every(k=>integer(record[k])&&record[k]>=0)||
    !Array.isArray(record.marks)||record.marks.length>2||
    !record.accounts||Object.keys(record.accounts).sort().join(',')!==IDS.slice().sort().join(',')||
    new TextEncoder().encode(JSON.stringify(record)).byteLength>32768)fail('CORRUPT_STATE');
  const trades=new Set();
  for(const m of record.marks) {
    if(!m||typeof m.tradeId!=='string'||trades.has(m.tradeId)||!['CE','PE'].includes(m.kind)||
      typeof m.symbol!=='string'||!m.symbol.endsWith(m.kind)||!positive(m.token)||!positive(m.lotSize)||
      (m.strike!==null&&!positive(m.strike))||!positive(m.bidPaise)||!positive(m.askPaise)||m.askPaise<=m.bidPaise||
      (m.askPaise-m.bidPaise)*200>(m.askPaise+m.bidPaise)*2||!positive(m.bidQuantity)||
      !positive(m.updatedAtMs)||record.observedAtMs-m.updatedAtMs>15000||m.updatedAtMs-record.observedAtMs>3000)
      fail('CORRUPT_MARK');
    trades.add(m.tradeId);
  }
  for(const id of IDS) {
    const h=record.accounts[id];
    if(!h||!positive(h.peakEquityPaise)||!integer(h.maxDrawdownPaise)||h.maxDrawdownPaise<0||
      h.maxDrawdownPaise>h.peakEquityPaise||typeof h.maxDrawdownPercent!=='number'||
      !Number.isFinite(h.maxDrawdownPercent)||h.maxDrawdownPercent<0||h.maxDrawdownPercent>100||
      typeof h.historyComplete!=='boolean'||!positive(h.startedAtMs)||h.startedAtMs>record.observedAtMs||
      !positive(h.samples)||h.samples>500000||!integer(h.missingSamples)||h.missingSamples<0||
      !Array.isArray(h.recent)||h.recent.length<1||h.recent.length>128||h.recent.length>h.samples)fail('CORRUPT_HISTORY');
    let previous=0;
    for(const sample of h.recent) {
      if(!sample||!positive(sample.atMs)||sample.atMs<h.startedAtMs||sample.atMs<=previous||sample.atMs>record.observedAtMs||
        (sample.equityPaise!==null&&(!integer(sample.equityPaise)||sample.equityPaise<0||
          sample.equityPaise>h.peakEquityPaise)))fail('CORRUPT_HISTORY_SAMPLE');
      previous=sample.atMs;
    }
    if(h.recent.at(-1).atMs!==record.observedAtMs)fail('CORRUPT_HISTORY_CLOCK');
  }
  return true;
}

function auditForBook(record,bridge,ledger) {
  auditObservedPortfolio(record);
  if(!recordMatches(record,bridge,ledger))fail('STALE_BOOK_BINDING');
  for(const mark of record.marks) {
    const p=ledger.positions.find(p=>p.tradeId===mark.tradeId&&p.status==='OPEN');
    if(!p||!same(mark,p)||mark.bidQuantity<p.lots*p.lotSize||mark.updatedAtMs<p.entryQuoteAtMs)
      fail('ORPHAN_MARK');
  }
}

/** Called inside the SAME transaction as observed paper balances/outbox. */
export function captureObservedPortfolio(prior,oldBridge,oldLedger,bridge,ledger,quotes,nowMs=bridge.lastOptionAtMs) {
  auditPaperLedger(ledger);auditReadOnlyBridge(bridge);
  if(!positive(nowMs)||nowMs<ledger.lastMutationAtMs||nowMs<bridge.lastOptionAtMs||
    !validClaimedTickId(bridge.lastOptionTickId)||!Array.isArray(quotes)||quotes.length>6)fail('INVALID_CAPTURE');
  if(prior!==undefined) {
    if(!oldBridge||!oldLedger)fail('ORPHAN_HISTORY');
    auditForBook(prior,oldBridge,oldLedger);
    if(nowMs<prior.observedAtMs)fail('CLOCK_ROLLBACK');
    if(recordMatches(prior,bridge,ledger)&&prior.observedAtMs===nowMs)return prior;
  }
  const marks=[];
  for(const p of ledger.positions.filter(p=>p.status==='OPEN')) {
    for(const q of quotes.filter(q=>q?.contract&&same(q.contract,p)).sort((a,b)=>b.updatedAtMs-a.updatedAtMs)) {
      try {
        const {c,bid,ask}=checkQuote(q,nowMs);
        if(q.bidQuantity<p.lots*p.lotSize||q.updatedAtMs<p.entryQuoteAtMs||day(p.entryAtMs)!==day(nowMs))continue;
        marks.push({tradeId:p.tradeId,symbol:c.symbol,kind:c.kind,expiry:c.expiry,token:c.token,
          lotSize:c.lotSize,strike:c.strike??null,bidPaise:bid,askPaise:ask,
          bidQuantity:q.bidQuantity,updatedAtMs:q.updatedAtMs});break;
      } catch { /* Invalid data creates an unavailable mark, never a guessed price. */ }
    }
  }
  const accounts={};
  for(const id of IDS) {
    const own=ledger.positions.filter(p=>p.accountId===id&&paperPositionActive(p));
    const values=own.map(p=>positionValue(p,marks,nowMs));
    const known=values.every(v=>v.value!==null);
    const equity=known?sum([ledger.accounts[id].cashPaise,...values.map(v=>v.value.creditPaise)]):null;
    const realized=accountingHistory(ledger,id);
    const previous=prior?.accounts[id];
    const initial=ledger.accounts[id].initialPaise;
    const recent=previous?structuredClone(previous.recent):[];
    const newTime=recent.at(-1)?.atMs!==nowMs;
    let gap=false;
    if(previous&&oldLedger.positions.some(p=>p.accountId===id&&p.status==='OPEN')&&
      oldBridge.lastOptionTickId!==bridge.lastOptionTickId) {
      const [oldDay,oldSlot]=oldBridge.lastOptionTickId.split(':'),[newDay,newSlot]=bridge.lastOptionTickId.split(':');
      gap=oldDay!==newDay||Number(newSlot)-Number(oldSlot)!==1;
    }
    const peak=Math.max(previous?.peakEquityPaise??initial,realized.peakPaise,equity??0);
    const drawdown=equity===null?null:peak-equity;
    const sample={atMs:nowMs,equityPaise:equity};
    if(newTime)recent.push(sample);else recent[recent.length-1]=sample;
    accounts[id]={peakEquityPaise:peak,
      maxDrawdownPaise:Math.max(previous?.maxDrawdownPaise??realized.drawdownPaise,drawdown??0),
      maxDrawdownPercent:Math.max(previous?.maxDrawdownPercent??realized.drawdownPercent,drawdown===null?0:pct(drawdown,peak)),
      historyComplete:(previous?.historyComplete??!(oldLedger?.positions.length))&&known&&!gap,
      startedAtMs:previous?.startedAtMs??nowMs,samples:(previous?.samples??0)+(newTime?1:0),
      missingSamples:(previous?.missingSamples??0)+(newTime&&!known?1:0),recent:recent.slice(-128)};
  }
  const record={schema:1,source:SOURCE,lastTickId:bridge.lastOptionTickId,
    bridgeObservedAtMs:bridge.lastOptionAtMs,observedAtMs:nowMs,ledgerMutationAtMs:ledger.lastMutationAtMs,
    positionCount:ledger.positions.length,rejectionCount:ledger.rejections.length,outboxCount:ledger.outbox.length,marks,accounts};
  auditForBook(record,bridge,ledger);return record;
}

export function observedPortfolioMetrics(ledger,bridge,record,nowMs,reportDay=day(nowMs)) {
  auditPaperLedger(ledger);auditReadOnlyBridge(bridge);
  if(!positive(nowMs)||nowMs<ledger.lastMutationAtMs||(bridge.lastOptionAtMs!==null&&nowMs<bridge.lastOptionAtMs))fail('INVALID_REPORT_CLOCK');
  let metricsStatus='METRICS_HISTORY_UNAVAILABLE',valid=false;
  if(record!==undefined) {
    try {auditForBook(record,bridge,ledger);if(nowMs<record.observedAtMs)fail('CLOCK_ROLLBACK');valid=true;metricsStatus='METRICS_STATE_VERIFIED';}
    catch {metricsStatus='INVALID_OR_ORPHANED_METRICS';}
  }
  const marks=valid?record.marks:[];
  const trades=new Map();
  for(const p of ledger.positions) {
    const valuation=positionValue(p,marks,nowMs),qty=p.lots*p.lotSize;
    const stop=exitValue(p,p.stopBidPaise,day(p.entryAtMs)),target=exitValue(p,p.targetBidPaise,day(p.entryAtMs));
    const risk=stop?p.entryDebitPaise-stop.creditPaise:null,reward=target?target.creditPaise-p.entryDebitPaise:null;
    trades.set(p.tradeId,{strike:p.strike??valuation.mark?.strike??null,
      strikeStatus:p.strike!==undefined?'RECORDED':valuation.mark?.strike?'VERIFIED_CURRENT_CONTRACT':'LEGACY_NOT_RECORDED',
      quantity:qty,currentPremiumRupees:valuation.mark?rs(valuation.mark.bidPaise):null,
      currentPremiumBasis:'OBSERVED_BID',markAtMs:valuation.mark?.updatedAtMs??null,
      valuationStatus:valuation.status,estimatedExitFillRupees:valuation.value?rs(valuation.value.fillPaise):null,
      estimatedExitFeeRupees:valuation.value?rs(valuation.value.feePaise):null,
      unrealizedPnlRupees:valuation.value?rs(valuation.value.creditPaise-p.entryDebitPaise):p.status==='CLOSED'?0:null,
      entryFeeRupees:rs(p.entryFeePaise),exitFeeRupees:p.status==='CLOSED'?rs(p.exitFeePaise):null,
      incurredFeesRupees:rs(p.entryFeePaise+(p.exitFeePaise??0)),entryDebitRupees:rs(p.entryDebitPaise),
      ownerWriteOffRupees:p.status==='EXIT_WRITTEN_OFF'?rs(p.entryDebitPaise):0,
      ownerResolutionAtMs:p.ownerResolution?.atMs??null,
      netRiskRupees:rs(risk),netPotentialRewardRupees:rs(reward),
      netRiskReward:risk!==null&&risk>0&&reward!==null?Number((reward/risk).toFixed(4)):null});
  }
  const accounts=IDS.map(id=>{
    const own=ledger.positions.filter(p=>p.accountId===id),active=own.filter(paperPositionActive);
    const values=active.map(p=>positionValue(p,marks,nowMs));
    const known=values.every(v=>v.value!==null),reserved=sum(active.map(p=>p.entryDebitPaise));
    const credit=known?sum(values.map(v=>v.value.creditPaise)):null;
    const equity=known?sum([ledger.accounts[id].cashPaise,credit]):null;
    const history=valid?record.accounts[id]:null;
    const peak=history?.peakEquityPaise??(own.length===0?ledger.accounts[id].initialPaise:null);
    const drawdown=equity!==null&&peak!==null?Math.max(0,peak-equity):null;
    const lifetime=closedStatistics(ledger,id);
    const initial=ledger.accounts[id].initialPaise;
    return {accountId:id,markedEquityRupees:rs(equity),unrealizedPnlRupees:known?rs(credit-reserved):null,
      totalNetPnlRupees:equity===null?null:rs(equity-initial),totalReturnPercent:equity===null?null:pct(equity-initial,initial),
      availableCapitalRupees:rs(ledger.accounts[id].cashPaise),capitalCommittedRupees:rs(reserved),
      ...ownerAdjustmentStatistics(ledger,id),
      incurredFeesRupees:rs(sum(own.map(p=>p.entryFeePaise+(p.exitFeePaise??0)))),
      estimatedOpenExitFeesRupees:known?rs(sum(values.map(v=>v.value.feePaise))):null,
      grossRealizedBeforeFeesRupees:rs(sum(own.filter(p=>p.status==='CLOSED').map(p=>(p.exitFillPaise-p.entryFillPaise)*p.lots*p.lotSize))),
      valuationStatus:active.length===0?'FLAT_CASH':known?'FRESH_OBSERVED_BID':values.find(v=>!v.value).status,
      peakEquityRupees:rs(peak),drawdownRupees:rs(drawdown),drawdownPercent:drawdown===null?null:pct(drawdown,peak),
      maxDrawdownRupees:history?rs(history.maxDrawdownPaise):own.length===0?0:null,
      maxDrawdownPercent:history?.maxDrawdownPercent??(own.length===0?0:null),
      drawdownBasis:own.some(p=>p.status==='EXIT_WRITTEN_OFF')?'SAMPLED_PAPER_EQUITY_INCLUDING_OWNER_WRITE_OFFS':'SAMPLED_NET_LIQUIDATION_EQUITY',
      sampledHistoryComplete:history?.historyComplete??own.length===0,
      historyStartedAtMs:history?.startedAtMs??null,missingValuationSamples:history?.missingSamples??null,
      recentEquitySamples:history?.recent.map(s=>({atMs:s.atMs,equityRupees:rs(s.equityPaise)}))??[],
      ...lifetime};
  });
  const months=[...new Set([reportDay.slice(0,7),...ledger.positions.filter(p=>p.status==='CLOSED'||p.status==='EXIT_WRITTEN_OFF')
    .map(p=>day(p.status==='CLOSED'?p.exitAtMs:p.ownerResolution.atMs).slice(0,7))])].sort();
  const daily=IDS.map(accountId=>({accountId,...closedStatistics(ledger,accountId,p=>day(p.exitAtMs)===reportDay),
    ...ownerAdjustmentStatistics(ledger,accountId,p=>day(p.ownerResolution.atMs)===reportDay)}));
  const monthly=months.flatMap(month=>IDS.map(accountId=>({month,accountId,
    ...closedStatistics(ledger,accountId,p=>day(p.exitAtMs).startsWith(month)),
    ...ownerAdjustmentStatistics(ledger,accountId,p=>day(p.ownerResolution.atMs).startsWith(month))})));
  return {metricsStatus,accounts,trades,monthly,daily,
    valuationMethod:'PAPER_BID_MINUS_ADVERSE_SLIPPAGE_AND_ESTIMATED_SELL_FEES',
    healthStatus:accounts.some(a=>a.valuationStatus==='BLOCKED_UNVERIFIABLE_EXIT')?'BLOCKED_UNVERIFIABLE_EXIT':
      accounts.some(a=>!['FLAT_CASH','FRESH_OBSERVED_BID'].includes(a.valuationStatus))?'MISSING_OR_STALE_POSITION_MARK':
      metricsStatus==='INVALID_OR_ORPHANED_METRICS'?'METRICS_HISTORY_UNAVAILABLE':'PAPER_ACCOUNTING_AVAILABLE'};
}
