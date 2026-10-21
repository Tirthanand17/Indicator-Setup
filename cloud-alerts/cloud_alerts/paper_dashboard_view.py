"""Mobile-first, read-only paper trading dashboard markup.

No external CDNs, cookies, browser storage, broker credentials or trade actions.
The dashboard API key lives only in the current page's JS memory.
"""
from __future__ import annotations

HTML = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NIFTY Paper Lab · Research Dashboard</title>
<style>
:root{color-scheme:dark;font:15px system-ui,-apple-system,sans-serif;background:#08111f;color:#e6f0ff}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(#10233c,#08111f 320px);min-height:100vh}
header,main,footer{max-width:1160px;margin:auto;padding:22px}header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
h1{font-size:1.65rem;letter-spacing:-.03em;margin:0}h2{font-size:1.12rem;margin:0 0 13px}p{color:#b2c5da}
.brand{color:#57e4d2;font-weight:750;letter-spacing:.13em;font-size:.76rem}
.tag{border:1px solid #325473;color:#9fc7e6;border-radius:30px;padding:8px 13px;font-size:.78rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:15px;margin:16px 0}
.card{background:#13233a;border:1px solid #2b435f;border-radius:15px;padding:18px;min-width:0}
.big{font-size:1.8rem;font-weight:760;margin-top:6px;letter-spacing:-.03em}
.muted{color:#91abc7;font-size:.84rem}.row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:10px}
strong{color:#e7f6ff}.positive{color:#59e1b1}.negative{color:#ff98a0}
input{background:#071324;color:white;border:1px solid #42617e;border-radius:8px;padding:12px;min-width:240px;flex:1}
button{background:#27d5bd;color:#071c28;border:0;border-radius:8px;font-weight:750;padding:12px 17px;cursor:pointer}
button:hover{filter:brightness(1.1)}.auth{display:flex;gap:9px;flex-wrap:wrap}
.chart{height:205px;display:flex;align-items:center;justify-content:center}
svg{width:100%;height:100%;overflow:visible}.tablewrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.82rem}th,td{padding:11px 9px;text-align:left;border-bottom:1px solid #26425c;white-space:nowrap}
th{color:#93c4e0}details{max-width:350px}summary{cursor:pointer}
footer{color:#90a8c4;font-size:.78rem;padding-bottom:28px}
#status{font-size:.87rem}.note{border-left:3px solid #e3b84e;padding:10px 15px;color:#decc96;background:#25263b}
@media(max-width:600px){header,main,footer{padding:15px}.big{font-size:1.48rem}.auth{width:100%}input{width:100%;min-width:0}}
</style></head>
<body><header><div><div class="brand">NIFTY · PAPER RESEARCH</div><h1>Options Paper Dashboard</h1></div>
<div class="tag">SIMULATION ONLY · NO ORDERS</div></header>
<main>
<div class="card"><h2>Private research access</h2>
<div class="auth"><input id="key" type="password" autocomplete="off" aria-label="Dashboard access key" placeholder="Enter paper dashboard access key">
<button id="login">View paper accounts</button></div>
<p id="status" role="status">No live broker data is exposed here until the simulator is enabled and connected.</p>
<div class="note">Quotes are hypothetical references, not exchange-confirmed fills. Missing exit quotes produce unknown equity, never invented P&amp;L.</div></div>
<section id="accounts" class="grid" aria-label="Paper accounts"></section>
<section class="grid"><div class="card"><h2>Realized P&L curves — separate portfolios</h2><div id="equity" class="chart muted">No verified paper quote pairs yet</div></div>
<div class="card"><h2>Performance summary</h2><div id="stats" class="muted">Waiting for simulated trades</div></div></section>
<section class="card"><h2>Recent simulated trades</h2><div class="tablewrap" id="trades">No paper history loaded.</div></section>
<section class="card"><h2>Five-indicator decisions and missed opportunities</h2>
<p>Recorded from completed NIFTY futures candles. A move in hindsight is not a validated missed CE/PE trade.</p>
<div class="auth"><input id="auditDay" type="date" aria-label="Filter completed-candle decisions by trading date">
<button id="auditFilter">Filter decisions</button></div>
<div id="auditSummary" class="muted">No strategy observations loaded.</div>
<div class="tablewrap" id="audits">No decision evidence loaded.</div></section>
</main><footer>Research software only. Timezone: Asia/Kolkata. Estimates use observed option BID/ASK, configured fees and adverse slippage; no real broker execution.</footer>
<script nonce="__NONCE__">
"use strict";
const NS="http://www.w3.org/2000/svg";
let secret="";let currentAccounts=[];let latestTrades=[];
const el=id=>document.getElementById(id);
const fmt=value=>value==null?"Unverifiable":"₹"+Number(value).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const add=(parent,tag,txt,cls="")=>{const node=document.createElement(tag);node.textContent=txt;if(cls)node.className=cls;parent.appendChild(node);return node};
async function read(path){
 const response=await fetch(path,{method:"GET",cache:"no-store",redirect:"error",headers:{"X-Paper-Dashboard-Key":secret}});
 if(!response.ok)throw Error("Unable to load private paper dashboard; verify the key and service status");
 return response.json()
}
function accountsView(data){
 const root=el("accounts");root.replaceChildren();
 for(const a of data.accounts){
  const card=add(root,"article","","card");
  add(card,"h2",a.id.replace("PAPER_","₹").replace("K","000")+" PAPER");
  add(card,"div",fmt(a.available_cash_rs),"big");
  add(card,"div","Available virtual cash","muted");
  const r=add(card,"div","","row");add(r,"span","Initial "+fmt(a.initial_rs));add(r,"strong","Open "+a.open_positions);
  const r2=add(card,"div","","row");add(r2,"span","Realized P&L");add(r2,"strong",fmt(a.realized_pnl_rs),a.realized_pnl_rs>=0?"positive":"negative");
  const r3=add(card,"div","","row");add(r3,"span","Closed trades "+a.closed_trades);add(r3,"strong","Equity "+fmt(a.equity_rs));
 }
}
function drawChart(analytics){
 const root=el("equity");root.replaceChildren();
 const curves=analytics.accounts.map(a=>({name:a.id,values:a.realized_equity_curve}))
   .filter(a=>a.values.length>0);
 if(!curves.length){root.textContent="No completed paper trades";return}
 const values=curves.flatMap(a=>[0,...a.values.map(x=>x.cumulative_pnl_rs)]);
 const lo=Math.min(...values),hi=Math.max(...values),span=Math.max(hi-lo,1);
 const svg=document.createElementNS(NS,"svg");svg.setAttribute("viewBox","0 0 600 190");
 svg.setAttribute("role","img");svg.setAttribute("aria-label","Two separate realized-only portfolio curves");
 const colors=["#27d5bd","#baaaff"];
 for(let i=0;i<curves.length;i++){
   const series=[0,...curves[i].values.map(x=>x.cumulative_pnl_rs)];
   const points=series.map((v,j)=>(20+j*550/Math.max(1,series.length-1)).toFixed(1)+
      ","+(168-(v-lo)/span*140).toFixed(1)).join(" ");
   const line=document.createElementNS(NS,"polyline");
   line.setAttribute("points",points);line.setAttribute("fill","none");
   line.setAttribute("stroke",colors[i%colors.length]);line.setAttribute("stroke-width","3");
   svg.appendChild(line);
   const legend=add(root,"div",curves[i].name+" — realized changes only","muted");
   legend.style.color=colors[i%colors.length];
 }
 root.appendChild(svg);
}
function statsView(analytics){
 const root=el("stats");root.replaceChildren();
 for(const a of analytics.accounts){
   const section=add(root,"div","","row");
   add(section,"strong",a.id);
   add(section,"span","Net "+fmt(a.net_realized_rs));
   add(root,"p","Closed "+a.closed_trades+" · Win rate "+
     (a.win_rate_pct==null?"insufficient data":a.win_rate_pct+"%")+
     " · Max realized drawdown "+fmt(a.max_realized_drawdown_rs));
   add(root,"p","CE "+fmt(a.pnl_by_option_kind.CE?.net_realized_rs??0)+
     " · PE "+fmt(a.pnl_by_option_kind.PE?.net_realized_rs??0));
   add(root,"p","Today "+a.day_return_pct_on_initial+"% · Week "+
     a.week_return_pct_on_initial+"% · Month "+a.month_return_pct_on_initial+
     "% of initial paper capital");
   add(root,"p","Profit factor "+(a.profit_factor==null?"N/A":a.profit_factor)+
     " · Unverifiable exits "+a.unverifiable);
 }
 add(root,"p","Realized-only research. Unknown exit quotes do not count as wins or losses.");
}
function tradesView(trades){
 const root=el("trades");root.replaceChildren();
 if(!trades.length){root.textContent="No simulated trades recorded.";return}
 const t=document.createElement("table"),head=document.createElement("thead"),hr=document.createElement("tr");
 for(const h of ["Trade","Account","Entry (IST)","Contract","Lots","Status","Modeled net P&L","Details"])add(hr,"th",h);
 head.appendChild(hr);t.appendChild(head);
 const body=document.createElement("tbody");
 for(const v of trades){
  const tr=document.createElement("tr");
  for(const field of [v.trade_id,v.account_id,v.entry_at,v.option_symbol,String(v.lots),v.status,fmt(v.net_pnl_rs)])
   add(tr,"td",field);
  const td=document.createElement("td"),d=document.createElement("details");
  add(d,"summary","Quote evidence");
  add(d,"p","ASK "+fmt(v.entry_ask_rs)+" | Hypothetical fill "+fmt(v.entry_fill_rs));
  add(d,"p","Exit BID "+fmt(v.exit_bid_rs)+" | Exit reason "+(v.exit_reason||"PENDING"));
  add(d,"p","Quoted "+v.entry_quote_at+"; actual fill unverified");
  td.appendChild(d);tr.appendChild(td);body.appendChild(tr);
 }
 t.appendChild(body);root.appendChild(t);
}
function auditView(data){
 const summary=el("auditSummary"),root=el("audits");
 summary.replaceChildren();root.replaceChildren();
 const stats=data.audit;
 add(summary,"p","Qualifying signals: "+stats.strategy_qualified+
     " · Liquidity rejections: "+stats.liquidity_rejected+
     " · Account risk rejections: "+stats.risk_rejected);
 add(summary,"p","Missed trade P&L: unverified unless matching historical option quotes were captured.");
 if(!data.evaluations.length){root.textContent="No completed-candle decisions recorded.";return}
 const t=document.createElement("table"),h=document.createElement("thead"),r=document.createElement("tr");
 for(const title of ["Observed (UTC)","Future","Stage","Outcome","Reason","Option"])add(r,"th",title);
 h.appendChild(r);t.appendChild(h);
 const body=document.createElement("tbody");
 for(const record of data.evaluations){
  const tr=document.createElement("tr");
  for(const val of [record.observed_at_utc,record.future_symbol,record.stage,
                    record.outcome,record.reason_code,record.option_symbol||"—"])
   add(tr,"td",String(val));
  body.appendChild(tr)
 }
 t.appendChild(body);root.appendChild(t);
}
async function refresh(){
 if(!secret)return;
 try{
  const selectedDay=el("auditDay").value;
  const auditUrl="/paper/api/opportunities"+
     (/^\\d{4}-\\d{2}-\\d{2}$/.test(selectedDay)?"?date="+encodeURIComponent(selectedDay):"");
  const [summary,history,opportunities,analytics]=await Promise.all([
    read("/paper/api/summary"),read("/paper/api/trades"),
    read(auditUrl),read("/paper/api/analytics")]);
  currentAccounts=summary.accounts;latestTrades=history.trades;
  accountsView(summary);statsView(analytics);drawChart(analytics);tradesView(latestTrades);
  auditView(opportunities);
  el("status").textContent="Updated "+new Date().toLocaleTimeString("en-IN")+
   " · "+(summary.mode||"PAPER ONLY")+" · simulated fills only";
 }catch(e){el("status").textContent=e.message;}
}
el("auditFilter").addEventListener("click",()=>refresh());
el("login").addEventListener("click",()=>{
 secret=el("key").value;el("key").value="";refresh();
});
setInterval(()=>{if(secret)refresh()},15000);
</script></body></html>"""


def page(nonce: str) -> str:
    if not nonce or not nonce.isascii() or not nonce.replace('-', '').replace('_','').isalnum():
        raise ValueError('invalid dashboard response nonce')
    return HTML.replace('__NONCE__',nonce)
