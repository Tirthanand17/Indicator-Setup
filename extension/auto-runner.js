/* Pure state transitions for tab-open, near-close, automatic paper-signal reviews. */
(function(root, factory) {
  const api=factory(typeof module==='object'&&module.exports?require('./auto-engine.js'):root.AutoEngine);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.AutoRunner=api;
})(typeof self!=='undefined'?self:globalThis,function(Engine){
'use strict';
function blank(){return {last:null,history:[],latest:null,lastStatus:'WAIT_DATA',lastReasons:['Collecting live chart data'],virtual:null,signal:null,barCount:0};}
function ingest(state, sample) {
  const s=state&&typeof state==='object'?{...state,history:[...(state.history||[])]}:blank();
  const events=[];
  if(!sample||!Number.isFinite(sample.at)||!Engine.validReading(sample.values)){
    s.lastStatus='WAIT_DATA';s.lastReasons=['Invalid frame reading'];return {state:s,events};
  }
  if(s.last&&s.last.values.symbol!==sample.values.symbol){Object.assign(s,blank());}
  if(s.last&&sample.at<=s.last.at){return {state:s,events};}
  s.latest=sample;
  if(!s.last){s.last=sample;s.lastStatus='WAIT_DATA';s.lastReasons=['Waiting to observe first five-minute candle closing'];return {state:s,events};}
  if(Math.floor(sample.at/Engine.FIVE)===Math.floor(s.last.at/Engine.FIVE)){
    s.last=sample;
    // lastStatus intentionally unchanged until the 5m boundary
    return {state:s,events};
  }
  const result=Engine.confirmNearClosed(s.last,sample);
  s.last=sample;
  if(!result.ok){s.history=[];s.virtual=null;s.lastStatus='WAIT_DATA';s.lastReasons=[result.reason];return {state:s,events};}
  const bar=result.bar;
  const prior=s.history;
  const decision=Engine.assess(bar,prior);
  s.history=[...s.history,bar].slice(-12);
  s.barCount=(s.barCount||0)+1;
  s.lastStatus=decision.status;s.lastReasons=decision.reasons;s.lastCandle=bar;
  // Existing virtual paper candidate gets exit evaluation first; no access to holdings or option quotes.
  if(s.virtual){
    const close=Engine.exitVirtual(s.virtual,bar);
    if(close.notify){events.push({status:close.status,reason:close.reason,bar,virtual:s.virtual});s.virtual=null;s.lastStatus=close.status;s.lastReasons=[close.reason];return {state:s,events};}
  }
  if(decision.notify&&!s.virtual){
    const direction=decision.status==='REVIEW_CE'?'CE':'PE';
    const v=Engine.virtualPosition(bar,direction);
    s.virtual=v;
    events.push({status:decision.status,reason:decision.reasons.join('; '),bar,virtual:v});
  }
  return {state:s,events};
}
return {blank,ingest};
});
