/** Phase20: disabled-by-default private paper dashboard. No broker/network calls. */
import { auditPaperLedger, paperLedgerSummary } from './paper-ledger.mjs';
import { auditSyntheticSession } from './synthetic-session.mjs';
import { portfolioValuation } from './portfolio-valuation.mjs';
import { privateReadOnlySnapshot } from './readonly-dashboard.mjs';
import { OBSERVED_PORTFOLIO_KEY } from './observed-portfolio.mjs';
import { READONLY_PAPER_LEDGER_KEY, READONLY_PAPER_BRIDGE_KEY } from './readonly-paper-bridge.mjs';
import { READONLY_PAPER_DELIVERY_KEY } from './readonly-delivery.mjs';

const COOKIE = '__Host-paper_session';
const SESSION_MS = 15 * 60_000;
const IST_OFFSET_MS = 330 * 60_000;
const encoder = new TextEncoder();
const HEADERS = Object.freeze({
  'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
});
const response = (body, status = 200, extra = {}) =>
  new Response(body, { status, headers: { ...HEADERS, ...extra } });
const json = (data, status = 200) => response(JSON.stringify(data), status,
  { 'Content-Type': 'application/json; charset=utf-8' });
const html = (body, status = 200) => response(body, status,
  { 'Content-Type': 'text/html; charset=utf-8' });
const notFound = () => json({ error: 'Not found' }, 404);
const unavailable = (status) => json({ status, paperOnly: true }, 503);
const goodKey = key => typeof key === 'string' && key.length >= 32 &&
  key.length <= 256 && new Set(key).size >= 8;
const base64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const secretKey = async secret => crypto.subtle.importKey('raw', encoder.encode(secret),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

function fixedEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length > 256 || b.length > 256) return false;
  const x = encoder.encode(a), y = encoder.encode(b);
  let difference = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return difference === 0;
}

export async function issueDashboardSession(secret, nowMs = Date.now()) {
  if (!goodKey(secret) || !Number.isSafeInteger(nowMs) || nowMs <= 0) throw Error('INVALID_DASHBOARD_SESSION');
  const expiry = nowMs + SESSION_MS;
  const nonce = base64(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `v1.${expiry}.${nonce}`;
  const signature = base64(new Uint8Array(await crypto.subtle.sign('HMAC', await secretKey(secret), encoder.encode(payload))));
  return `${payload}.${signature}`;
}

export async function verifyDashboardSession(token, secret, nowMs = Date.now()) {
  if (!goodKey(secret) || typeof token !== 'string' || token.length > 220 ||
    !Number.isSafeInteger(nowMs) || nowMs <= 0) return false;
  const match = /^(v1)\.(\d{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expiry = Number(match[2]);
  if (!Number.isSafeInteger(expiry) || expiry <= nowMs || expiry - nowMs > SESSION_MS) return false;
  const payload = `${match[1]}.${match[2]}.${match[3]}`;
  const expected = base64(new Uint8Array(await crypto.subtle.sign('HMAC', await secretKey(secret), encoder.encode(payload))));
  return fixedEqual(expected, match[4]);
}

const dayIST = ms => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
const validDay = date => typeof date === 'string' && /^2026-\d\d-\d\d$/.test(date) &&
  !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const rupees = paise => paise === null ? null : Number((paise / 100).toFixed(2));

/** Audit complete persisted state *before* displaying any derived numbers. */
export function privateDashboardSummary(ledger, session, schedulerStatus = 'NOT_INITIALIZED') {
  auditPaperLedger(ledger);
  if (session !== undefined) auditSyntheticSession(session);
  return { status: 'READY', source: session ? 'OFFLINE_SYNTHETIC_TEST_ONLY' : 'PAPER_LEDGER_ONLY',
    syntheticOnly: true, paperOnly: true, realOrdersEnabled: false,
    dashboardReadOnly: true, markedToMarket: false, liveMarketConnected: false,
    schedulerStatus, accounts: paperLedgerSummary(ledger).accounts.map(a => ({
      ...a, initialRupees: rupees(a.initialPaise), cashRupees: rupees(a.cashPaise),
      realizedNetPnlRupees: rupees(a.realizedNetPnlPaise),
      valuationNote: a.openCount + a.unverifiableCount > 0 ?
        'CASH_ONLY_NOT_EQUITY_NO_VERIFIED_MTM' : 'CASH_ONLY_NO_OPEN_POSITIONS',
    })),
    tradeCount: ledger.positions.length, pendingOutboxCount: ledger.outbox.length,
    rejectionCount: ledger.rejections.length, lastMutationAtMs: ledger.lastMutationAtMs,
    syntheticTicks: session?.totalTicks ?? 0, syntheticLastTickAtMs: session?.lastObservedAtMs ?? null,
    telegramDelivered: false };
}

export function privateDashboardTrades(ledger, { account = 'ALL', limit = '30' } = {}) {
  auditPaperLedger(ledger);
  if (!['ALL', 'PAPER_50K', 'PAPER_100K'].includes(account) ||
    !/^(?:[1-9]|[1-4]\d|50)$/.test(String(limit))) throw Error('INVALID_TRADES_QUERY');
  const selected = ledger.positions.filter(p => account === 'ALL' || p.accountId === account);
  const trades = selected.slice().reverse().slice(0, Number(limit)).map(p => ({
    tradeId: p.tradeId, accountId: p.accountId, symbol: p.symbol, kind: p.kind,
    status: p.status, lots: p.lots, lotSize: p.lotSize, entryAtMs: p.entryAtMs,
    entryFillRupees: rupees(p.entryFillPaise), entryDebitRupees: rupees(p.entryDebitPaise),
    entryFeeRupees: rupees(p.entryFeePaise), exitAtMs: p.exitAtMs,
    exitFillRupees: p.status === 'CLOSED' ? rupees(p.exitFillPaise) : null,
    exitFeeRupees: p.status === 'CLOSED' ? rupees(p.exitFeePaise) : null,
    netPnlRupees: p.status === 'CLOSED' ? rupees(p.netPnlPaise) : null,
    exitReason: p.status === 'CLOSED' ? p.exitReason : null,
  }));
  return { paperOnly: true, syntheticOnly: true, total: selected.length, trades };
}

export function privateDashboardDaily(ledger, day) {
  auditPaperLedger(ledger);
  if (!validDay(day)) throw Error('INVALID_REPORT_DAY');
  return { day, paperOnly: true, syntheticOnly: true, markedToMarket: false,
    accounts: ['PAPER_50K', 'PAPER_100K'].map(accountId => {
      const entries = ledger.positions.filter(p => p.accountId === accountId && dayIST(p.entryAtMs) === day);
      const exits = ledger.positions.filter(p => p.accountId === accountId &&
        p.status === 'CLOSED' && dayIST(p.exitAtMs) === day);
      const realized = exits.reduce((sum, p) => sum + p.netPnlPaise, 0);
      return { accountId, entries: entries.length, verifiedExits: exits.length,
        wins: exits.filter(p => p.netPnlPaise > 0).length,
        losses: exits.filter(p => p.netPnlPaise < 0).length,
        breakeven: exits.filter(p => p.netPnlPaise === 0).length,
        unresolvedEntries: entries.filter(p => p.status === 'EXIT_UNVERIFIABLE').length,
        openEntries: entries.filter(p => p.status === 'OPEN').length,
        realizedNetPnlRupees: rupees(realized),
        winRate: exits.length ? Number((100 * exits.filter(p => p.netPnlPaise > 0).length / exits.length).toFixed(1)) : null,
      };
    }) };
}

const LOGIN = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paper Lab — Private access</title><link rel="stylesheet" href="/paper/assets/dashboard.css"></head><body class="login"><main class="login-card"><div class="brand">◈ PAPER LAB</div><h1>Private paper dashboard</h1><p>Read-only simulated market research. Enter the separate dashboard viewing key.</p><form action="/paper/login" method="post"><label for="key">Viewing key</label><input id="key" name="key" type="password" minlength="32" maxlength="256" autocomplete="off" required><button type="submit">Open dashboard</button></form><p class="warning">No broker orders, no verified market fills, no live P&amp;L.</p></main></body></html>`;
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paper Lab — Research dashboard</title><link rel="stylesheet" href="/paper/assets/dashboard.css"><script src="/paper/assets/dashboard.js" defer></script></head><body><div class="layout"><header><div><div class="brand">◈ PAPER LAB <span class="pill">SYNTHETIC ONLY</span></div><h1>Paper trading overview</h1><p>Read-only NIFTY options research • ₹50k and ₹100k separate accounts</p></div><form method="post" action="/paper/logout"><button class="ghost" type="submit">Sign out</button></form></header><aside id="status" role="status">Loading local research data…</aside><section class="cards" id="accounts" aria-label="Paper accounts"></section><section class="panel"><div class="section-head"><div><h2>Portfolio capital and system health</h2><p>Indicative equity uses only current synthetic BID quotes after slippage and modeled exit fees. Missing evidence means unavailable, never zero. This is not live NSE MTM.</p></div></div><div class="cards" id="portfolio" aria-label="Synthetic capital and health"></div></section><section class="panel"><div class="section-head"><div><h2>Daily report</h2><p>Realized exits only — no fabricated open-position valuation.</p></div><div class="inline"><label for="day">IST trading day</label><input type="date" id="day"><button id="refresh">Refresh</button></div></div><div class="cards" id="daily"></div></section><section class="panel"><div class="section-head"><div><h2>Simulated trade journal</h2><p>Modeled ASK entries, BID exits, estimated fees and slippage.</p></div><label for="account">Account <select id="account"><option value="ALL">Both accounts</option><option value="PAPER_50K">₹50,000</option><option value="PAPER_100K">₹1,00,000</option></select></label></div><div class="table-wrap"><table><thead><tr><th>Time (IST)</th><th>Account</th><th>Contract</th><th>Side</th><th>Lots</th><th>Entry</th><th>Exit</th><th>Net P&amp;L</th><th>State</th></tr></thead><tbody id="trades"><tr><td colspan="9">Loading…</td></tr></tbody></table></div></section><footer>SIMULATED ONLY · NOT AN ORDER OR INVESTMENT RECOMMENDATION · No direct broker trading · No verified market feed · Dashboard data refreshes every 15 seconds</footer></div></body></html>`;
const READONLY_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paper Lab — Read-only Kite paper accounts</title><link rel="stylesheet" href="/paper/assets/dashboard.css"><script src="/paper/assets/readonly.js" defer></script></head><body><div class="layout"><header><div><div class="brand">◈ PAPER LAB <span class="pill">KITE OBSERVATION · PAPER ONLY</span></div><h1>Market-observed paper accounts</h1><p>Read-only observations, simulated entries and exits; no broker orders or confirmed fills.</p></div><form method="post" action="/paper/logout"><button class="ghost" type="submit">Sign out</button></form></header><aside id="status" role="status">Waiting for trusted paper records…</aside><section class="cards" id="accounts" aria-label="Independent paper accounts"></section><section class="panel"><h2>Cash and valuation</h2><p>Net liquidation uses fresh observed BID, adverse slippage and estimated sell fees. Missing prices remain unavailable. Drawdown covers sampled observations, with gaps disclosed.</p><div class="cards" id="capital"></div></section><section class="panel"><h2>Closed-trade statistics and equity history</h2><p>Lifetime and selected month; after modeled costs. Recent equity observations retain at most 128 samples per account. Sampled drawdown can miss moves between ticks.</p><div class="cards" id="statistics"></div><div class="table-wrap"><table><thead><tr><th>Account</th><th>IST sample time</th><th>Net liquidation equity</th></tr></thead><tbody id="equity"></tbody></table></div></section><section class="panel"><div class="section-head"><div><h2>IST daily report</h2><p>Closed paper exits only; unresolved exits are excluded from realized P&amp;L.</p></div><div class="inline"><label for="day">Trading day</label><input type="date" id="day"><button id="refresh">Refresh</button></div></div><div class="cards" id="daily"></div></section><section class="panel"><div class="section-head"><div><h2>Paper trade history</h2><p>Actual observations, hypothetical fills. Does not prove the exchange would fill an order.</p></div><label for="account">Account <select id="account"><option value="ALL">Both accounts</option><option value="PAPER_50K">₹50,000</option><option value="PAPER_100K">₹1,00,000</option></select></label></div><div class="table-wrap"><table><thead><tr><th>Entry time (IST)</th><th>Account</th><th>Contract</th><th>Expiry</th><th>Side</th><th>Strike</th><th>Lots / quantity</th><th>Entry</th><th>Current BID</th><th>Unrealized net</th><th>Exit</th><th>Net P&amp;L</th><th>Fees incurred</th><th>Net risk / reward</th><th>Status</th></tr></thead><tbody id="trades"><tr><td colspan="15">Loading…</td></tr></tbody></table></div></section><footer>PAPER ONLY · ₹0 REAL ORDERS · PHONE RECEIPT UNVERIFIED · MARKET DATA CAN BE STALE · 15-second local refresh</footer></div></body></html>`;
const STYLE = `:root{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#071225;color:#eaf5ff;color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 90% -10%,#0b5379 0,transparent 38%),#071225}button,input,select{font:inherit}button{background:#0bd0c5;color:#042237;font-weight:750;border:0;border-radius:10px;padding:11px 16px;cursor:pointer}button:hover{background:#70f5de}.ghost{background:#172d47;color:#d6edfb}.layout{max-width:1220px;margin:auto;padding:clamp(18px,4vw,44px)}header,.section-head{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}h1{font-size:clamp(1.8rem,4vw,2.8rem);margin:16px 0 8px}h2{margin:0 0 7px}p{color:#9db6ce;line-height:1.5}.brand{font-size:.8rem;letter-spacing:.19em;color:#53efd7;font-weight:850}.pill{border-radius:100px;padding:6px 9px;background:#123c59;letter-spacing:.04em;font-size:.65rem}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,265px),1fr));gap:16px;margin:22px 0}.card,.panel,.login-card{background:#102039;border:1px solid #24445e;box-shadow:0 14px 30px #03102055;border-radius:16px;padding:22px}.card h3{margin:0 0 14px;color:#aed2e5;font-size:.92rem}.big{font-size:clamp(1.4rem,3vw,2rem);font-weight:800;color:#f5ffff}.muted{color:#a3bad2;font-size:.86rem}.panel{margin:22px 0}.inline{display:flex;align-items:center;gap:10px;flex-wrap:wrap}label{font-size:.86rem;color:#bfd4e3}input,select{background:#08182c;color:#fff;padding:10px;border:1px solid #33536e;border-radius:9px;max-width:100%}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap;font-size:.9rem}th,td{padding:12px;border-bottom:1px solid #2a4056}th{color:#a6c2d5;font-size:.79rem}td.positive{color:#74f7c7}td.negative{color:#ffb5b5}#status{padding:13px 18px;background:#283246;border-left:4px solid #f2cc78;border-radius:8px;margin-top:20px}.warning{color:#f9d791}footer{text-align:center;font-size:.75rem;color:#8ba5b9;padding:20px}.login{min-height:100vh;display:grid;place-items:center;padding:20px}.login-card{width:min(100%,430px)}.login-card form{display:grid;gap:12px;margin:22px 0}.login-card input{width:100%}@media(max-width:600px){.panel,.card{padding:17px}header{align-items:flex-start}.inline{width:100%}.inline input{flex:1;min-width:125px}}`;
const JS = `const money=n=>n===null||n===undefined?'Unavailable':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(n);const el=id=>document.getElementById(id);const fmt=t=>t?new Date(t+330*60000).toISOString().slice(0,16).replace('T',' '):'—';const node=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;n.textContent=value;return n};const label=(title,value,sub)=>{const c=node('article','card','');c.append(node('h3','',title),node('div','big',value),node('p','muted',sub));return c};async function get(url){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(r.status===404||r.status===401){location.assign('/paper/dashboard');throw Error('Session expired')}if(!r.ok)throw Error('Dashboard data unavailable');return r.json()}async function refresh(){try{const [summary,daily,trades,portfolio]=await Promise.all([get('/paper/api/summary'),get('/paper/api/daily?date='+encodeURIComponent(el('day').value)),get('/paper/api/trades?account='+encodeURIComponent(el('account').value)+'&limit=50'),get('/paper/api/portfolio')]);if(summary.status!=='READY')throw Error('Data not ready');el('status').textContent='OFFLINE SYNTHETIC TEST ONLY · '+summary.schedulerStatus+' · '+summary.syntheticTicks+' simulated ticks · Last record '+fmt(summary.lastMutationAtMs)+' IST · '+portfolio.healthStatus+' · Alerts NOT sent · No verified live data';el('accounts').replaceChildren(...summary.accounts.map(a=>label(a.accountId==='PAPER_50K'?'₹50,000 paper account':'₹1,00,000 paper account',money(a.cashRupees)+' cash',money(a.realizedNetPnlRupees)+' realized P&L · '+a.openCount+' open · '+a.unverifiableCount+' unresolved · Cash is not MTM equity')));el('portfolio').replaceChildren(...portfolio.accounts.map(a=>label(a.accountId==='PAPER_50K'?'₹50,000 capital and equity':'₹1,00,000 capital and equity',money(a.indicativeEquityRupees)+' indicative',money(a.availableCashRupees)+' spendable cash · '+money(a.reservedEntryDebitRupees)+' committed · '+money(a.hypotheticalOpenNetPnlRupees)+' hypothetical open P&L · '+a.valuationStatus)));el('daily').replaceChildren(...daily.accounts.map(a=>label(a.accountId==='PAPER_50K'?'₹50,000 daily report':'₹1,00,000 daily report',money(a.realizedNetPnlRupees),a.entries+' entries · '+a.verifiedExits+' verified exits · '+(a.winRate===null?'N/A':a.winRate+'%')+' win rate · '+a.unresolvedEntries+' unresolved')));const rows=trades.trades.map(t=>{const tr=document.createElement('tr');const values=[fmt(t.entryAtMs),t.accountId,t.symbol,t.kind,t.lots,money(t.entryFillRupees),money(t.exitFillRupees),money(t.netPnlRupees),t.status];values.forEach((v,i)=>tr.append(node('td',i===7&&t.netPnlRupees!==null?(t.netPnlRupees>=0?'positive':'negative'):'',String(v))));return tr});if(!rows.length){const tr=document.createElement('tr');const td=node('td','','No simulated trades recorded');td.colSpan=9;tr.append(td);rows.push(tr)}el('trades').replaceChildren(...rows)}catch(e){el('status').textContent='UNAVAILABLE / FAIL CLOSED — '+e.message;el('accounts').replaceChildren();el('portfolio').replaceChildren();el('daily').replaceChildren();el('trades').replaceChildren()}}el('day').value=new Date(Date.now()+330*60000).toISOString().slice(0,10);el('refresh').addEventListener('click',refresh);el('account').addEventListener('change',refresh);el('day').addEventListener('change',refresh);refresh();setInterval(()=>{if(!document.hidden)refresh()},15000);`;
const READONLY_JS = `const el=id=>document.getElementById(id);
const cash=n=>n===null||n===undefined?'Unavailable':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(n);
const ist=ms=>ms?new Date(ms+330*60000).toISOString().slice(0,19).replace('T',' '):'—';
const node=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;n.textContent=value;return n};
const card=(title,value,sub)=>{const c=node('article','card','');c.append(node('h3','',title),node('div','big',value),node('p','muted',sub));return c};
const label=id=>id==='PAPER_50K'?'₹50,000':'₹1,00,000';
const stats=a=>a.closedTrades+' closed · '+(a.winRate===null?'N/A':a.winRate+'%')+' wins · Average win '+cash(a.averageWinningTradeRupees)+' / loss '+cash(a.averageLosingTradeRupees)+' · Expectancy '+cash(a.expectancyRupees)+' · Profit factor '+(a.profitFactor??a.profitFactorStatus);
async function refresh(){try{
 const url='/paper/api/readonly?date='+encodeURIComponent(el('day').value)+'&account='+encodeURIComponent(el('account').value)+'&limit=50';
 const r=await fetch(url,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
 if(r.status===404){location.assign('/paper/dashboard');throw Error('Private session unavailable')}
 if(!r.ok)throw Error('Verified paper report unavailable');const v=await r.json();
 if(v.status!=='READY'||v.source!=='READONLY_KITE_EVIDENCE_PAPER_ONLY')throw Error('Untrusted source');
 el('status').textContent='READ-ONLY PAPER · '+v.healthStatus+' · '+v.metricsStatus+' · '+v.evidenceStatus+' · Scheduler '+v.schedulerStatus+' · Last option sample '+ist(v.lastOptionAtMs)+' IST · '+v.totalOptionTicks+' ticks · '+(v.delivery?v.pendingOutboxCount+' pending · '+v.delivery.acceptedByBotApi+' API accepted · '+(v.delivery.blockingState??'Queue ready'):'Delivery status unavailable')+' · PHONE RECEIPT UNVERIFIED · NO REAL ORDERS';
 el('accounts').replaceChildren(...v.accounts.map(a=>card(label(a.accountId)+' paper account',cash(a.cashRupees)+' cash',cash(a.realizedNetPnlRupees)+' realized · '+a.openCount+' open · '+a.unverifiableCount+' unresolved · Committed '+cash(a.capitalCommittedRupees)+' · Fees incurred '+cash(a.incurredFeesRupees))));
 el('capital').replaceChildren(...v.accounts.map(a=>card(label(a.accountId)+' net liquidation',cash(a.markedEquityRupees),a.valuationStatus+' · Unrealized net '+cash(a.unrealizedPnlRupees)+' · Total return '+(a.totalReturnPercent??'Unavailable')+'% · Peak '+cash(a.peakEquityRupees)+' · Current drawdown '+cash(a.drawdownRupees)+' · Maximum sampled drawdown '+cash(a.maxDrawdownRupees)+' · '+(a.sampledHistoryComplete?'Sample history complete':'Incomplete sample history')+' · Missing samples '+(a.missingValuationSamples??'Unknown'))));
 el('statistics').replaceChildren(...v.accounts.map(a=>card(label(a.accountId)+' lifetime',cash(a.realizedNetPnlRupees),stats(a))),...v.monthly.filter(a=>a.month===v.day.slice(0,7)).map(a=>card(label(a.accountId)+' '+a.month,cash(a.realizedNetPnlRupees),stats(a))));
 const samples=v.accounts.flatMap(a=>a.recentEquitySamples.map(s=>{const row=node('tr','','');[label(a.accountId),ist(s.atMs),cash(s.equityRupees)].forEach(x=>row.append(node('td','',x)));return row}));el('equity').replaceChildren(...samples);
 el('daily').replaceChildren(...v.daily.map(a=>card(label(a.accountId)+' daily net',cash(a.realizedNetPnlRupees),a.entries+' entries · '+a.verifiedExits+' closed · '+a.unresolvedEntries+' unresolved · '+stats(a))));
 const rows=v.trades.map(t=>{const row=document.createElement('tr');[ist(t.entryAtMs),t.accountId,t.symbol,t.expiry,t.kind,t.strike??'Not recorded',t.lots+' / '+t.quantity,cash(t.entryFillRupees),cash(t.currentPremiumRupees),cash(t.unrealizedPnlRupees),cash(t.exitFillRupees),cash(t.netPnlRupees),cash(t.incurredFeesRupees),cash(t.netRiskRupees)+' / '+cash(t.netPotentialRewardRupees)+' ('+(t.netRiskReward??'N/A')+')',t.status+' · '+t.valuationStatus].forEach(value=>row.append(node('td','',String(value))));return row});
 if(!rows.length){const row=node('tr','','');const td=node('td','','No read-only paper positions recorded');td.colSpan=15;row.append(td);rows.push(row)}el('trades').replaceChildren(...rows);
 }catch(e){el('status').textContent='UNAVAILABLE / FAIL CLOSED — '+e.message;for(const id of ['accounts','capital','daily','statistics','equity','trades'])el(id).replaceChildren()}}
el('day').value=new Date(Date.now()+330*60000).toISOString().slice(0,10);for(const id of ['refresh','day','account'])el(id).addEventListener(id==='refresh'?'click':'change',refresh);refresh();setInterval(()=>{if(!document.hidden)refresh()},15000);`;

const parseCookie = raw => {
  if (!raw || raw.length > 2048) return null;
  const values = raw.split(';').map(s => s.trim()).filter(s => s.startsWith(`${COOKIE}=`));
  return values.length === 1 ? values[0].slice(COOKIE.length + 1) : null;
};
const cookieOptions = value => `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict`;

async function boundedForm(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let bytes = 0, parts = [];
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024) { await reader.cancel(); return null; }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(bytes);let offset = 0;
  for (const part of parts) { buffer.set(part, offset); offset += part.byteLength; }
  try {
    const form = new URLSearchParams(new TextDecoder('utf-8',{fatal:true}).decode(buffer));
    if ([...form.keys()].length !== 1 || !form.has('key')) return null;
    return form.get('key');
  } catch { return null; }
}

/** Only GET routes can read stored accounting state. Auth is checked twice. */
export async function handlePrivateDashboard(request, env, storage, schedulerKey = 'scheduler-v1',
  ledgerKey = 'paper-ledger-v1', sessionKey = 'synthetic-session-v1',
  marksKey = 'synthetic-portfolio-marks-v1') {
  const {pathname,searchParams,protocol} = new URL(request.url);
  const readOnlyMode = env.OFFLINE_PAPER_BRIDGE_ENABLED === 'true' &&
    env.OFFLINE_OPTION_SNAPSHOT_ENABLED === 'true' &&
    env.OFFLINE_READONLY_REVIEW_ENABLED === 'true' &&
    env.READONLY_MARKET_RUNTIME_ENABLED === 'true';
  if (env.OFFLINE_SCHEDULER_ENABLED !== 'true' ||
      (env.OFFLINE_PAPER_LEDGER_ENABLED !== 'true' && !readOnlyMode) ||
      env.OFFLINE_PRIVATE_DASHBOARD_ENABLED !== 'true') return notFound();
  if (protocol !== 'https:' || !goodKey(env.PAPER_DASHBOARD_VIEW_KEY) ||
      env.PAPER_DASHBOARD_VIEW_KEY === env.SCHEDULER_ADMIN_KEY) {
    return unavailable('DASHBOARD_CONFIGURATION_BLOCKED');
  }
  if (['/paper/dashboard','/paper/login','/paper/logout',
    '/paper/assets/dashboard.css','/paper/assets/dashboard.js'].includes(pathname) &&
    searchParams.size !== 0) return notFound();
  if (request.method === 'GET' && pathname === '/paper/assets/dashboard.css') return response(STYLE,200,{'Content-Type':'text/css; charset=utf-8'});
  if (request.method === 'GET' && pathname === '/paper/assets/dashboard.js') return response(JS,200,{'Content-Type':'text/javascript; charset=utf-8'});
  if (request.method === 'GET' && pathname === '/paper/assets/readonly.js' && readOnlyMode &&
      searchParams.size === 0) return response(READONLY_JS,200,{'Content-Type':'text/javascript; charset=utf-8'});
  if (pathname === '/paper/login' && request.method === 'POST') {
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== new URL(request.url).origin) return notFound();
    const entered = await boundedForm(request);
    if (!goodKey(entered) || !fixedEqual(entered,env.PAPER_DASHBOARD_VIEW_KEY)) return html(LOGIN,401);
    const cookie = await issueDashboardSession(env.PAPER_DASHBOARD_VIEW_KEY);
    return response(null,303,{'Location':'/paper/dashboard','Set-Cookie':cookieOptions(cookie)});
  }
  const authenticated = await verifyDashboardSession(parseCookie(request.headers.get('cookie')),
    env.PAPER_DASHBOARD_VIEW_KEY);
  if (pathname === '/paper/dashboard' && request.method === 'GET') {
    return html(authenticated ? (readOnlyMode ? READONLY_PAGE : PAGE) : LOGIN);
  }
  if (pathname === '/paper/logout' && request.method === 'POST' && authenticated) {
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== new URL(request.url).origin) return notFound();
    return response(null,303,{'Location':'/paper/dashboard',
      'Set-Cookie':cookieOptions('')+'; Max-Age=0'});
  }
  if (!authenticated || request.method !== 'GET') return notFound();
  if (pathname === '/paper/api/readonly') {
    if (!readOnlyMode) return notFound();
    const queryNames=[...searchParams.keys()];
    if(new Set(queryNames).size!==queryNames.length ||
       queryNames.some(k=>!['date','account','limit'].includes(k))) return notFound();
    const [bridge,readonlyLedger,scheduler,deliveryJournal,portfolioMetrics]=await Promise.all([
      storage.get(READONLY_PAPER_BRIDGE_KEY),storage.get(READONLY_PAPER_LEDGER_KEY),
      storage.get(schedulerKey),storage.get(READONLY_PAPER_DELIVERY_KEY),storage.get(OBSERVED_PORTFOLIO_KEY)]);
    if(bridge===undefined||readonlyLedger===undefined)return unavailable('READONLY_PAPER_NOT_INITIALIZED');
    try {
      const status=scheduler?.status&&typeof scheduler.status==='string'&&
        /^[A-Z_]{2,60}$/.test(scheduler.status)?scheduler.status:'NOT_INITIALIZED';
      return json(privateReadOnlySnapshot(bridge,readonlyLedger,{
        account:searchParams.get('account')??'ALL',
        day:searchParams.get('date')??undefined,
        limit:searchParams.get('limit')??'50',schedulerStatus:status,deliveryJournal,portfolioMetrics}));
    } catch {return unavailable('BLOCKED_INVALID_READONLY_PAPER_REPORT');}
  }
  if (!['/paper/api/summary','/paper/api/trades','/paper/api/daily',
    '/paper/api/portfolio'].includes(pathname)) return notFound();
  const queryNames = [...searchParams.keys()];
  if (new Set(queryNames).size !== queryNames.length ||
      (['/paper/api/summary','/paper/api/portfolio'].includes(pathname) &&
       queryNames.length !== 0)) return notFound();
  const [ledger,session,scheduler,marks] = await Promise.all([
    storage.get(ledgerKey),storage.get(sessionKey),storage.get(schedulerKey),
    pathname === '/paper/api/portfolio' ? storage.get(marksKey) : Promise.resolve(undefined),
  ]);
  if (ledger === undefined) return unavailable('NOT_INITIALIZED');
  try {
    const status = scheduler?.status && typeof scheduler.status === 'string' &&
      /^[A-Z_]{2,60}$/.test(scheduler.status) ? scheduler.status : 'NOT_INITIALIZED';
    if (pathname === '/paper/api/portfolio') {
      return json(portfolioValuation(ledger, session, marks, Date.now(), status));
    }
    if (pathname === '/paper/api/summary') {
      return json(privateDashboardSummary(ledger,session,status));
    }
    if (pathname === '/paper/api/trades') {
      if ([...searchParams.keys()].some(k=>!['account','limit'].includes(k))) return notFound();
      return json(privateDashboardTrades(ledger,{account:searchParams.get('account')??'ALL',
        limit:searchParams.get('limit')??'30'}));
    }
    if ([...searchParams.keys()].some(k=>k!=='date')) return notFound();
    return json(privateDashboardDaily(ledger,searchParams.get('date')??dayIST(Date.now())));
  } catch { return unavailable('BLOCKED_INVALID_REPORT_STATE_OR_QUERY'); }
}

export const isPrivateDashboardPath = path => path.startsWith('/paper/');
