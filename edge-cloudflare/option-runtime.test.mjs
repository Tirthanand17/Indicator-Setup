import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveQuoteRequest, recordQuoteFailure, clearQuoteAuthBlock,
  validateQuotePace, quotePaceStatus, optionRuntimeForDay, claimMasterFetch, commitMasterPair,
  noteMasterFailure, claimOptionSnapshot, finishOptionSnapshot,
  noteOptionFailure, optionStatus, validateOptionRuntime } from './option-runtime.mjs';
import { validatePairEvidence } from './option-readonly.mjs';

const at=hhmm=>Date.parse('2026-10-23T'+hhmm+':00+05:30');
const tick=n=>'2026-10-23:'+n;
const samplePair=()=>({expiry:'2026-10-29',strike:25100,masterFetchedAtMs:at('09:15'),
  CE:{symbol:'NIFTY26O2925100CE',kind:'CE',expiry:'2026-10-29',strike:25100,
    token:12_101,lotSize:65,tickSize:0.05},
  PE:{symbol:'NIFTY26O2925100PE',kind:'PE',expiry:'2026-10-29',strike:25100,
    token:12_102,lotSize:65,tickSize:0.05}});
const quote=(c,atTime='2026-10-23 09:15:22')=>({timestamp:atTime,
  instrument_token:c.token,depth:{buy:[{price:100,quantity:130}],
    sell:[{price:100.5,quantity:130}]}});

test('durable quote reservation prevents repeat tick, same-second burst and out-of-order slots',()=>{
  const first=reserveQuoteRequest(null,{tickId:tick(0),observedAtMs:at('09:15'),kind:'FUTURE'});
  assert.equal(first.allowed,true);
  assert.equal(first.state.count,1);
  assert.equal(reserveQuoteRequest(first.state,{tickId:tick(0),observedAtMs:at('09:15'),kind:'FUTURE'}).allowed,false);
  assert.equal(reserveQuoteRequest(first.state,{tickId:tick(1),observedAtMs:at('09:15')+500,kind:'OPTION_PAIR'}).allowed,false);
  assert.equal(reserveQuoteRequest(first.state,{tickId:tick(1),observedAtMs:at('09:15')+20_000,kind:'OPTION_PAIR'}).allowed,true);
  const next=reserveQuoteRequest(first.state,{tickId:tick(1),observedAtMs:at('09:15')+20_000,kind:'OPTION_PAIR'});
  assert.equal(reserveQuoteRequest(next.state,{tickId:tick(0),observedAtMs:at('09:15')+25_000,kind:'FUTURE'}).allowed,false);
});

test('HTTP 429 blocks attempts for one minute; only fresh token handoff lifts sticky 403',()=>{
  const start=reserveQuoteRequest(null,{tickId:tick(0),observedAtMs:at('09:15'),kind:'FUTURE'}).state;
  const cooldown=recordQuoteFailure(start,{tickId:tick(0),observedAtMs:at('09:15')+800,errorCode:'RATE_LIMITED'});
  assert.equal(reserveQuoteRequest(cooldown,{tickId:tick(1),observedAtMs:at('09:15')+20_000,kind:'OPTION_PAIR'}).reason,'RATE_COOLDOWN');
  const later=reserveQuoteRequest(cooldown,{tickId:tick(4),observedAtMs:at('09:15')+80_000,kind:'FUTURE'});
  assert.equal(later.allowed,true);
  const blocked=recordQuoteFailure(later.state,{tickId:tick(4),observedAtMs:at('09:15')+80_500,errorCode:'AUTH_EXPIRED'});
  assert.equal(reserveQuoteRequest(blocked,{tickId:tick(5),observedAtMs:at('09:15')+100_000,kind:'OPTION_PAIR'}).reason,'AUTH_BLOCKED');
  const lifted=clearQuoteAuthBlock(blocked);
  assert.equal(lifted.authBlocked,false);
  assert.equal(lifted.lastReservedAtMs,blocked.lastReservedAtMs);
  assert.equal(reserveQuoteRequest(lifted,{tickId:tick(5),observedAtMs:at('09:15')+100_000,kind:'OPTION_PAIR'}).allowed,true);
  assert.throws(()=>recordQuoteFailure(blocked,{tickId:tick(0),observedAtMs:at('09:15')+90_000,errorCode:'RATE_LIMITED'}));
});

test('invalid/corrupt state, unknown year and market closures cannot permit requests',()=>{
  assert.throws(()=>reserveQuoteRequest({schema:1},{tickId:tick(0),observedAtMs:at('09:15'),kind:'FUTURE'}));
  assert.throws(()=>reserveQuoteRequest(null,{tickId:'2027-01-01:1',observedAtMs:at('09:15'),kind:'FUTURE'}));
  assert.throws(()=>reserveQuoteRequest(null,{tickId:tick(0),observedAtMs:at('09:15'),kind:'ORDER'}));
  assert.throws(()=>reserveQuoteRequest(null,{tickId:'2026-10-24:0',observedAtMs:Date.parse('2026-10-24T09:15:00+05:30'),kind:'FUTURE'}));
  const prior=reserveQuoteRequest(null,{tickId:tick(0),observedAtMs:at('09:15'),kind:'FUTURE'}).state;
  const monday=Date.parse('2026-10-26T09:15:00+05:30');
  const next=reserveQuoteRequest(prior,{tickId:'2026-10-26:0',observedAtMs:monday,kind:'FUTURE'});
  assert.equal(next.allowed,true);
  assert.equal(next.state.count,1);
  assert.equal(validateQuotePace(next.state),true);
  assert.equal(quotePaceStatus(next.state,monday).status,'READY');
  assert.equal(quotePaceStatus(prior,monday).status,'NO_DAILY_REQUESTS');
});

test('bounded master refresh locks before IO and rejects duplicate/mismatched commits',()=>{
  const first=claimMasterFetch(undefined,{tickId:tick(0),observedAtMs:at('09:15')});
  assert.equal(first.allowed,true);
  assert.equal(first.state.status,'MASTER_PENDING');
  assert.equal(claimMasterFetch(first.state,{tickId:tick(1),observedAtMs:at('09:15')+20_000}).allowed,false);
  assert.throws(()=>commitMasterPair(first.state,{tickId:tick(1),pair:samplePair()}));
  const bad=noteMasterFailure(first.state,{tickId:tick(0)});
  assert.equal(bad.status,'MASTER_BLOCKED');
  const next=claimMasterFetch(bad,{tickId:tick(90),observedAtMs:at('09:45')});
  assert.equal(next.allowed,true);
  const selected=commitMasterPair(next.state,{tickId:tick(90),pair:samplePair()});
  assert.equal(selected.status,'MASTER_READY');
  assert.equal(selected.pair.CE.lotSize,65);
  assert.equal(claimMasterFetch(selected,{tickId:tick(91),observedAtMs:at('09:45')+20_000}).allowed,false);
  assert.equal(validateOptionRuntime(selected),true);
});

test('option snapshot is one-time per tick and stored only as non-authorizing evidence',()=>{
  const master=commitMasterPair(
    claimMasterFetch(undefined,{tickId:tick(0),observedAtMs:at('09:15')}).state,
    {tickId:tick(0),pair:samplePair()});
  const t=at('09:15')+25_000;
  const first=claimOptionSnapshot(master,{tickId:tick(2),observedAtMs:t});
  assert.equal(first.allowed,true);
  assert.equal(first.state.evidence,null);
  assert.equal(claimOptionSnapshot(first.state,{tickId:tick(2),observedAtMs:t}).allowed,false);
  assert.throws(()=>finishOptionSnapshot(first.state,{tickId:tick(3),evidence:{}}));
  const pair=samplePair();
  const evidence=validatePairEvidence({pair,observedAtMs:t,
    quotes:{CE:quote(pair.CE),PE:quote(pair.PE)}});
  const after=finishOptionSnapshot(first.state,{tickId:tick(2),evidence});
  assert.equal(optionStatus(after,t).evidenceFresh,true);
  assert.equal(optionStatus(after,t+20_000).evidenceFresh,false);
  assert.equal(optionStatus(after,t).paperEntryAuthorized,false);
  assert.equal(after.evidence.CE.contract.token,pair.CE.token);
  const uneven={...after,evidence:{...after.evidence,
    CE:{...after.evidence.CE,updatedAtMs:at('09:15')+10_000}}};
  assert.equal(optionStatus(uneven,at('09:15')+26_000).evidenceFresh,false);
  assert.throws(()=>validateOptionRuntime({...after,evidence:{...after.evidence,
    CE:{...after.evidence.CE,ask:99}}}));
  assert.throws(()=>finishOptionSnapshot(first.state,{tickId:tick(2),
    evidence:{...evidence,CE:{...evidence.CE,contract:{...evidence.CE.contract,
      symbol:'NIFTY26O2925200CE'}}}}));
  const second=claimOptionSnapshot(after,{tickId:tick(3),observedAtMs:t+20_000});
  assert.equal(second.allowed,true);
  assert.equal(second.state.evidence,null);
  assert.equal(noteOptionFailure(second.state,{tickId:tick(3)}).status,'OPTION_BLOCKED');
});

test('expired/day-rolled contract evidence is never reused and corrupt states fail closed',()=>{
  const initial=commitMasterPair(
    claimMasterFetch(undefined,{tickId:tick(0),observedAtMs:at('09:15')}).state,
    {tickId:tick(0),pair:samplePair()});
  const monday=Date.parse('2026-10-26T09:15:00+05:30');
  const rotated=optionRuntimeForDay(initial,monday);
  assert.equal(rotated.day,'2026-10-26');
  assert.equal(rotated.pair,null);
  assert.equal(rotated.evidence,null);
  assert.equal(rotated.attempts,0);
  assert.throws(()=>optionRuntimeForDay(initial,Date.parse('2026-10-22T09:15:00+05:30')));
  assert.throws(()=>optionRuntimeForDay(initial,Date.parse('2026-10-24T09:15:00+05:30')));
  assert.throws(()=>validateOptionRuntime({...initial,pair:{...initial.pair,CE:{...initial.pair.CE,token:'secret'}}}));
});
