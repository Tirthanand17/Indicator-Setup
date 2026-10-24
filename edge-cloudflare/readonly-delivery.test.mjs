import test from 'node:test';
import assert from 'node:assert/strict';
import { newPaperLedger, enterPaperBasket } from './paper-ledger.mjs';
import { auditPaperDelivery, claimPaperDelivery, settlePaperDelivery,
  paperDeliverySummary } from './paper-delivery.mjs';
import { READONLY_PAPER_DELIVERY_KEY,
  reconcileReadOnlyDeliveryJournal } from './readonly-delivery.mjs';
import worker from './worker.mjs';

const AT=Date.parse('2026-10-23T10:45:40+05:30');
const quote={contract:{symbol:'NIFTY26O2922050CE',kind:'CE',
  expiry:'2026-10-29',token:424242,lotSize:65},
  bid:100,ask:100.5,bidQuantity:650,askQuantity:650,updatedAtMs:AT-1_000};
const before=()=>newPaperLedger(AT);
const after=ledger=>enterPaperBasket(ledger,{signalId:'READONLY:2026-10-23:1729680000000:CE',
  nowMs:AT,quote}).ledger;

test('first read-only option tick provisions an independent journal atomically',()=>{
  const oldLedger=before(),newLedger=after(oldLedger);
  const journal=reconcileReadOnlyDeliveryJournal(undefined,undefined,newLedger,AT);
  assert.equal(auditPaperDelivery(journal,newLedger),true);
  assert.equal(journal.nextIndex,0);
  assert.equal(newLedger.outbox.length,2);
  assert.equal(READONLY_PAPER_DELIVERY_KEY,'readonly-paper-delivery-v1');
  const claimed=claimPaperDelivery(journal,newLedger,AT);
  assert.equal(claimed.result.sent,false);
  assert.equal(claimed.result.status,'SIMULATED_ATTEMPT_CLAIM');
  assert.equal(paperDeliverySummary(claimed.journal,newLedger).phoneDeliveredVerified,false);
  assert.strictEqual(reconcileReadOnlyDeliveryJournal(claimed.journal,newLedger,
    newLedger,AT+500),claimed.journal);
});

test('missing cursor with prior outbox is blocked; historic messages cannot be replayed',()=>{
  const ledger=after(before());
  assert.throws(()=>reconcileReadOnlyDeliveryJournal(undefined,ledger,ledger,AT),
    /MISSING_REPLAY_WATERMARK/);
  assert.throws(()=>reconcileReadOnlyDeliveryJournal({schema:99},ledger,ledger,AT),
    /PAPER_DELIVERY_/);
  const original=reconcileReadOnlyDeliveryJournal(undefined,undefined,ledger,AT);
  assert.throws(()=>reconcileReadOnlyDeliveryJournal(original,undefined,ledger,AT),
    /ORPHAN_JOURNAL/);
});

test('uncertain settlement stops reclaims after restart and does not imply phone delivery',()=>{
  const ledger=after(before());
  const initial=reconcileReadOnlyDeliveryJournal(undefined,undefined,ledger,AT);
  const first=claimPaperDelivery(initial,ledger,AT);
  const fault=settlePaperDelivery(first.journal,ledger,{eventId:first.result.eventId,
    attempt:1,nowMs:AT+1000,httpStatus:502,botResponse:null});
  assert.equal(fault.result.status,'AMBIGUOUS_ACK_REQUIRED');
  const restored=structuredClone(fault.journal);
  const next=claimPaperDelivery(restored,ledger,AT+60_000);
  assert.equal(next.result.status,'AMBIGUOUS_ACK_REQUIRED');
  assert.equal(next.journal.totalAttempts,1);
  assert.equal(paperDeliverySummary(next.journal,ledger).acceptedByBotApi,0);
});

test('production worker never exposes read-only delivery mutation routes',async()=>{
  const env={SCHEDULER_ADMIN_KEY:'read-only-paper-admin-0123456789-AaBbCc',
    OFFLINE_SCHEDULER_ENABLED:'true',OFFLINE_PAPER_BRIDGE_ENABLED:'true',
    OFFLINE_READONLY_DELIVERY_REHEARSAL_ENABLED:'true',
    MARKET_SESSION:{idFromName:()=>{throw Error('UNEXPECTED_DURABLE_OBJECT');}}};
  for(const route of ['/internal/readonly-delivery/claim',
    '/internal/readonly-delivery/settle',
    '/internal/readonly-delivery/suppress']) {
    const r=await worker.fetch(new Request(`https://unit.invalid${route}`,{
      method:'POST',headers:{authorization:'Bearer '+env.SCHEDULER_ADMIN_KEY},body:'x'}),env);
    assert.equal(r.status,404);
  }
});
