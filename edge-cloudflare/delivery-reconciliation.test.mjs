import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,AT} from './test-support/observed-archive-fixture.mjs';
import {settlePaperDelivery,claimPaperDelivery,newPaperDeliveryJournal} from './paper-delivery.mjs';
import {newPaperLedger,enterPaperBasket,exitPaperPosition} from './paper-ledger.mjs';
import {sessionStatus} from './alarm-core.mjs';
import {deliveryReconciliationView,reconcileUncertainDelivery,readReconciliationJSON,
  MAX_RECONCILIATION_BYTES} from './delivery-reconciliation.mjs';
import {runDeliveryReconciliationCLI} from './delivery-reconciliation-cli.mjs';
import worker from './worker.mjs';

const admin='synthetic-reconciliation-admin-0123456789-AbCd';
const setup=()=>{const s=fixture();s.scheduler={...s.scheduler,halted:true,scheduledAtMs:null,status:'OWNER_EMERGENCY_HALT'};
  const context={scheduler:s.scheduler,alarmAtMs:null,nowMs:AT+60000};
  return {...s,context,view:deliveryReconciliationView(s.ledger,s.delivery,context)};};

test('inspection is read-only and discloses exact uncertainty without bodies, tokens or invented receipts',()=>{
  const s=setup(),before=structuredClone(s.delivery),v=s.view;
  assert.equal(v.canSuppress,true);assert.equal(v.status,'OWNER_DECISION_REQUIRED');
  assert.equal(v.activeState,'CLAIMED_UNCONFIRMED');assert.equal(v.request.index,1);
  assert.equal(v.summary.acceptedByBotApi,1);assert.equal(v.phoneDeliveredVerified,false);
  for(const leak of ['observed-archive-entry-001 SIMULATED','message','bidQuantity','access_token'])
    assert.equal(JSON.stringify(v).includes(leak),false);
  assert.deepEqual(s.delivery,before);
});

test('suppression advances one durable prefix without a send, acceptance assertion or ledger mutation',()=>{
  const s=setup(),book=structuredClone(s.ledger),before=structuredClone(s.delivery);
  const out=reconcileUncertainDelivery(s.ledger,s.delivery,s.context,s.view.request);
  assert.equal(out.result.status,'SUPPRESSED_UNCERTAIN');assert.equal(out.result.deliveryAttempted,false);
  assert.equal(out.result.possibleTelegramAcceptance,true);assert.equal(out.result.deliveryOutcome,'UNKNOWN_OWNER_SUPPRESSED_RESEND');
  assert.equal(out.result.acceptedByTelegram,false);assert.equal(out.result.schedulerResumed,false);
  assert.equal(out.journal.nextIndex,2);assert.equal(out.journal.suppressed,1);assert.equal(out.journal.accepted,1);
  assert.equal(out.journal.recent.at(-1).status,'SUPPRESSED_UNCERTAIN');
  assert.equal(out.journal.recent.at(-1).telegramMessageId,null);
  assert.deepEqual(s.ledger,book);assert.deepEqual(s.delivery,before);
  const repeated=reconcileUncertainDelivery(s.ledger,out.journal,s.context,s.view.request);
  assert.equal(repeated.result.status,'ALREADY_TERMINAL_NO_ACTION');assert.equal(repeated.journal,out.journal);
  assert.equal(repeated.journal.nextIndex,2);
});

test('late definitive acknowledgement winning the race is never overwritten by suppression',()=>{
  const s=setup(),a=s.delivery.active;
  const accepted=settlePaperDelivery(s.delivery,s.ledger,{eventId:a.eventId,attempt:a.attempt,nowMs:AT+50000,
    httpStatus:200,botResponse:{ok:true,result:{message_id:9002}}}).journal;
  const out=reconcileUncertainDelivery(s.ledger,accepted,s.context,s.view.request);
  assert.equal(out.result.status,'ALREADY_TERMINAL_NO_ACTION');
  assert.equal(out.result.terminalStatus,'ACCEPTED_API_ONLY');assert.equal(out.journal.accepted,2);
  assert.equal(out.journal.suppressed,0);assert.equal(out.journal,accepted);
});

test('stale attempts, forged acknowledgements, malformed proof and unsafe source states cannot mutate the journal',()=>{
  const s=setup(),original=structuredClone(s.delivery),r=s.view.request;
  for(const change of [x=>{x.attempt++;},x=>{x.claimedAtMs++;},x=>{x.journalChangedAtMs++;},
    x=>{x.eventId+='wrong';},x=>{x.index++;},x=>{x.decision='MARK_DELIVERED';},
    x=>{x.notes='private-data';},x=>{x.index=-1;},x=>{x.attempt='1';}]) {
    const input=structuredClone(r);change(input);
    assert.throws(()=>reconcileUncertainDelivery(s.ledger,s.delivery,s.context,input));
  }
  for(const context of [{...s.context,scheduler:{...s.scheduler,halted:false}},
    {...s.context,alarmAtMs:AT+90000},{...s.context,quarantined:true},
    {...s.context,nowMs:AT+49999},{...s.context,nowMs:AT}])
    assert.throws(()=>reconcileUncertainDelivery(s.ledger,s.delivery,context,r));
  assert.deepEqual(s.delivery,original);
});

test('ambiguous responses are eligible after halt; rate-limit retries remain ineligible and stale attempts stay blocked',()=>{
  const s=setup(),a=s.delivery.active;
  const settle=(httpStatus,botResponse)=>settlePaperDelivery(s.delivery,s.ledger,
    {eventId:a.eventId,attempt:a.attempt,nowMs:AT+21000,httpStatus,botResponse}).journal;
  const ambiguous=settle(null,null),v=deliveryReconciliationView(s.ledger,ambiguous,s.context);
  assert.equal(v.activeState,'AMBIGUOUS');assert.equal(v.canSuppress,true);
  assert.equal(reconcileUncertainDelivery(s.ledger,ambiguous,s.context,v.request).journal.suppressed,1);
  const retry=settle(429,{ok:false,error_code:429,parameters:{retry_after:1}});
  assert.equal(deliveryReconciliationView(s.ledger,retry,s.context).canSuppress,false);
  assert.throws(()=>reconcileUncertainDelivery(s.ledger,retry,s.context,s.view.request));
  const second=claimPaperDelivery(retry,s.ledger,AT+23000).journal;
  assert.equal(second.active.attempt,2);
  assert.throws(()=>reconcileUncertainDelivery(s.ledger,second,s.context,s.view.request));
});

test('bounded JSON parsing refuses oversized, invalid UTF-8, malformed and absent input',async()=>{
  assert.deepEqual(await readReconciliationJSON(new Response('{"test":1}').body),{test:1});
  for(const body of [null,new Response('bad-json').body,new Response(new Uint8Array([255])).body,
    new Response('X'.repeat(MAX_RECONCILIATION_BYTES+1)).body])await assert.rejects(()=>readReconciliationJSON(body));
});

test('a terminal prefix remains unreplayable after its detailed receipt leaves the last-128 ring',()=>{
  const start=Date.parse('2026-04-02T10:00:00+05:30');let ledger=newPaperLedger(start),journal=newPaperDeliveryJournal(start);
  let firstRequest,lastAt=start,signals=0;
  const quote=(at,bid=100)=>({contract:{symbol:'NIFTY26DEC23000CE',kind:'CE',expiry:'2026-12-31',token:11111,lotSize:65},
    bid,ask:bid+.5,bidQuantity:650,askQuantity:650,updatedAtMs:at-1000});
  const context=at=>({scheduler:{...fixture().scheduler,halted:true,scheduledAtMs:null,status:'OWNER_EMERGENCY_HALT',lastObservedAtMs:at},
    alarmAtMs:null,nowMs:at});
  const drain=at=>{while(journal.nextIndex<ledger.outbox.length){
    const c=claimPaperDelivery(journal,ledger,at);journal=c.journal;
    journal=settlePaperDelivery(journal,ledger,{...c.result,nowMs:at,httpStatus:200,
      botResponse:{ok:true,result:{message_id:10000+journal.nextIndex}}}).journal;
  }};
  for(let offset=0;offset<80&&signals<33;offset++) {
    const at=start+offset*86400000,day=new Date(at+330*60000).toISOString().slice(0,10);
    if(sessionStatus(day)!=='REGULAR')continue;
    ledger=enterPaperBasket(ledger,{signalId:'receipt-retention-'+signals,nowMs:at,quote:quote(at)}).ledger;
    if(signals===0) {
      journal=claimPaperDelivery(journal,ledger,at).journal;
      firstRequest=deliveryReconciliationView(ledger,journal,context(at+30000)).request;
      journal=reconcileUncertainDelivery(ledger,journal,context(at+30000),firstRequest).journal;
    }
    drain(at+30000);
    for(const p of ledger.positions.filter(p=>p.status==='OPEN'))
      ledger=exitPaperPosition(ledger,{tradeId:p.tradeId,nowMs:at+60000,quote:quote(at+60000,141)}).ledger;
    drain(at+60000);lastAt=at+60000;signals++;
  }
  assert.equal(signals,33);assert.equal(journal.nextIndex,132);assert.equal(journal.recent.length,128);
  assert.equal(journal.suppressed,1);const before=structuredClone(journal);
  assert.throws(()=>reconcileUncertainDelivery(ledger,journal,context(lastAt+1000),firstRequest),/TERMINAL_RECEIPT_NOT_RETAINED/);
  assert.deepEqual(journal,before);
});

test('route gate requires admin, exact TLS path/method and opt-in before accessing the namespace',async()=>{
  const base={OFFLINE_SCHEDULER_ENABLED:'true',SCHEDULER_ADMIN_KEY:admin,OFFLINE_DELIVERY_RECONCILIATION_ENABLED:'true',
    MARKET_SESSION:{idFromName:()=>{throw Error('Must not access namespace');}}};
  for(const [url,method,auth,enabled] of [
    ['https://unit.invalid/internal/readonly-delivery/reconcile','GET',undefined,'true'],
    ['https://unit.invalid/internal/readonly-delivery/reconcile','POST','Bearer wrong','true'],
    ['http://unit.invalid/internal/readonly-delivery/reconcile','GET','Bearer '+admin,'true'],
    ['https://unit.invalid/internal/readonly-delivery/reconcile?key=bad','GET','Bearer '+admin,'true'],
    ['https://unit.invalid/internal/readonly-delivery/reconcile','PUT','Bearer '+admin,'true'],
    ['https://unit.invalid/internal/readonly-delivery/reconcile','GET','Bearer '+admin,'false']]) {
    const response=await worker.fetch(new Request(url,{method,headers:auth?{authorization:auth}:{}}),
      {...base,OFFLINE_DELIVERY_RECONCILIATION_ENABLED:enabled});assert.equal(response.status,404);
  }
});

test('operator client requires explicit suppression acknowledgement and preserves inspection files exclusively',async()=>{
  const s=setup(),logs=[],writes=[];let calls=0;
  const deps={env:{SCHEDULER_ADMIN_KEY:admin},log:x=>logs.push(x),read:async()=>s.view,
    write:async(...args)=>writes.push(args),fetchImpl:async(url,init)=>{
      calls++;assert.equal(url,'https://unit.invalid/internal/readonly-delivery/reconcile');
      assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');
      assert.equal(init.headers.authorization,'Bearer '+admin);
      return Response.json(init.method==='GET'?s.view:reconcileUncertainDelivery(s.ledger,s.delivery,s.context,JSON.parse(init.body)).result);}};
  assert.equal(await runDeliveryReconciliationCLI([],deps),0);assert.equal(calls,0);
  assert.equal(await runDeliveryReconciliationCLI(['inspect','https://unit.invalid','inspection.reconciliation.json'],deps),0);
  assert.equal(writes[0][2].flag,'wx');assert.equal(writes[0][2].mode,0o600);
  assert.equal(await runDeliveryReconciliationCLI(['suppress','https://unit.invalid','inspection.reconciliation.json'],deps),1);
  assert.equal(calls,1);
  assert.equal(await runDeliveryReconciliationCLI(['suppress','https://unit.invalid','inspection.reconciliation.json','--acknowledge-unknown-delivery'],deps),0);
  for(const origin of ['http://unit.invalid','https://secret@unit.invalid','https://unit.invalid?key=bad','https://unit.invalid/path'])
    assert.equal(await runDeliveryReconciliationCLI(['inspect',origin,'inspection.reconciliation.json'],deps),1);
  assert.equal(calls,2);
  assert.equal(await runDeliveryReconciliationCLI(['suppress','https://unit.invalid','inspection.reconciliation.json','--acknowledge-unknown-delivery'],
    {...deps,read:async()=>({...s.view,canSuppress:false})}),1);assert.equal(calls,2);
  assert.equal(await runDeliveryReconciliationCLI(['inspect','https://unit.invalid','existing.reconciliation.json'],
    {...deps,write:async()=>{throw Error('EEXIST');}}),1);
  assert.equal(logs.some(x=>x.includes(admin)||x.includes('observed-archive-entry-001')),false);
});
