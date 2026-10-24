// LOCAL TEST ENTRYPOINT ONLY. Never referenced by deployment configuration.
import worker, { MarketSession } from '../worker.mjs';
import { newPaperLedger } from '../paper-ledger.mjs';
import { READONLY_QUOTE_PACE_KEY, READONLY_OPTION_STATE_KEY,
  claimOptionSnapshot, finishOptionSnapshot, optionStatus } from '../option-runtime.mjs';
import { validatePairEvidence } from '../option-readonly.mjs';
import { READONLY_PAPER_LEDGER_KEY, READONLY_PAPER_BRIDGE_KEY,
  newReadOnlyBridge, stageReadOnlyReview, advanceReadOnlyPaperTurn,
  readOnlyBridgeSummary } from '../readonly-paper-bridge.mjs';
import { READONLY_PAPER_DELIVERY_KEY, reconcileReadOnlyDeliveryJournal } from '../readonly-delivery.mjs';
// Keep the synthetic clock ahead of the real timer so workerd does not
// immediately fire past-due alarms behind the test's explicit callbacks.
let clock = Date.now() + 120_000;
let ticked = false;
Date.now = () => clock;
export default worker;
export class TestSession extends MarketSession {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/test/now') return Response.json({ now: Date.now() });
    if (path === '/test/pipeline/clock' && request.method === 'POST') {
      const { nowMs } = await request.json();
      if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return Response.json({ error: 'INVALID_TEST_CLOCK' }, { status: 400 });
      clock = nowMs;
      return Response.json({ now: Date.now(), testOnly: true });
    }
    if (path === '/test/token-sealed') {
      const stored = await this.storage.get('daily-token-v1');
      return Response.json({ present: !!stored, encrypted: !!stored?.ciphertext,
        containsPlainToken: JSON.stringify(stored).includes('SYNTHETIC-ACCESS-TOKEN') });
    }
    // Offline-only fixtures for the protected option cadence. Production
    // worker.mjs exposes NONE of these write routes.
    if (path === '/test/option/pacing' && request.method === 'POST') {
      const input=await request.json();
      return Response.json(await this.reserveReadOnlyQuote(
        input.tickId,input.observedAtMs,input.kind));
    }
    if (path === '/test/option/master' && request.method === 'POST') {
      const input=await request.json();
      await this.refreshOptionMaster(input.tickId,input.observedAtMs,
        input.futuresLastPrice,{instrumentsNfoCsv:async()=>input.csv});
      const saved=await this.storage.get(READONLY_OPTION_STATE_KEY);
      return Response.json(optionStatus(saved,input.observedAtMs));
    }
    if (path === '/test/option/snapshot' && request.method === 'POST') {
      const input=await request.json();
      const result=await this.storage.transaction(async txn=>{
        const old=await txn.get(READONLY_OPTION_STATE_KEY);
        const claim=claimOptionSnapshot(old,{tickId:input.tickId,
          observedAtMs:input.observedAtMs});
        if(!claim.allowed) return {status:'SKIPPED'};
        const evidence=validatePairEvidence({pair:claim.state.pair,
          quotes:input.quotes,observedAtMs:input.observedAtMs});
        const state=finishOptionSnapshot(claim.state,{tickId:input.tickId,evidence});
        await txn.put(READONLY_OPTION_STATE_KEY,state);
        return optionStatus(state,input.observedAtMs);
      });
      return Response.json(result);
    }
    if (path === '/test/option/state') {
      const [option,pace]=await Promise.all([
        this.storage.get(READONLY_OPTION_STATE_KEY),
        this.storage.get(READONLY_QUOTE_PACE_KEY)]);
      return Response.json({option:optionStatus(option,Date.now()),pace:pace??null});
    }
    // Test-only atomic bridge transitions, never included in worker.mjs routes.
    if(path==='/test/read-only-paper/review'&&request.method==='POST') {
      const input=await request.json();
      const r=await this.storage.transaction(async txn=>{
        const old=await txn.get(READONLY_PAPER_BRIDGE_KEY);
        const next=stageReadOnlyReview(old??newReadOnlyBridge(),input);
        await txn.put(READONLY_PAPER_BRIDGE_KEY,next);
        return {staged:!!next.pending,signalId:next.pending?.signalId??null};
      });
      return Response.json(r);
    }
    if(path==='/test/read-only-paper/turn'&&request.method==='POST') {
      const input=await request.json();
      return Response.json(await this.storage.transaction(async txn=>{
        const [oldBridge,oldLedger,oldDelivery]=await Promise.all([
          txn.get(READONLY_PAPER_BRIDGE_KEY),txn.get(READONLY_PAPER_LEDGER_KEY),
          this.readonlyDeliveryRehearsalEnabled?
            txn.get(READONLY_PAPER_DELIVERY_KEY):Promise.resolve(undefined)]);
        const bridge=oldBridge??newReadOnlyBridge();
        const ledger=oldLedger??newPaperLedger(input.observedAtMs);
        const result=advanceReadOnlyPaperTurn(bridge,ledger,input);
        if(this.readonlyDeliveryRehearsalEnabled) {
          const nextDelivery=reconcileReadOnlyDeliveryJournal(oldDelivery,oldLedger,
            result.ledger,input.observedAtMs);
          if(nextDelivery!==oldDelivery)
            await txn.put(READONLY_PAPER_DELIVERY_KEY,nextDelivery);
        }
        if(result.state!==oldBridge) await txn.put(READONLY_PAPER_BRIDGE_KEY,result.state);
        if(result.ledger!==oldLedger) await txn.put(READONLY_PAPER_LEDGER_KEY,result.ledger);
        return result.result;
      }));
    }
    if(path==='/test/read-only-paper/state') {
      const [bridge,ledger]=await Promise.all([
        this.storage.get(READONLY_PAPER_BRIDGE_KEY),
        this.storage.get(READONLY_PAPER_LEDGER_KEY)]);
      if(!bridge||!ledger) return Response.json({status:'NOT_INITIALIZED'});
      return Response.json(readOnlyBridgeSummary(bridge,ledger));
    }
    if(path==='/test/read-only-paper/eod'&&request.method==='POST') {
      const {nowMs}=await request.json();
      return Response.json(await this.finalizeReadOnlyPaperDay(nowMs));
    }
    if(path==='/test/read-only-delivery/claim'&&request.method==='POST') {
      const {nowMs}=await request.json();
      return Response.json(await this.claimReadOnlyPaperDeliveryRehearsal(nowMs));
    }
    if(path==='/test/read-only-delivery/settle'&&request.method==='POST') {
      return Response.json(await this.settleReadOnlyPaperDeliveryRehearsal(await request.json()));
    }
    if(path==='/test/read-only-delivery/suppress'&&request.method==='POST') {
      return Response.json(await this.suppressReadOnlyPaperDeliveryRehearsal(await request.json()));
    }
    if(path==='/test/read-only-delivery/state') {
      return Response.json((await this.storage.get(READONLY_PAPER_DELIVERY_KEY))??null);
    }
    // These methods exist only in this LOCAL test harness; production has no
    // HTTP write route for simulated trades or alert dispatch.
    if (path === '/test/paper/state') {
      return Response.json((await this.storage.get('paper-ledger-v1')) ?? null);
    }
    if (path === '/test/paper/enter' && request.method === 'POST') {
      return Response.json(await this.enterPaperBasket(await request.json()));
    }
    if (path === '/test/paper/exit' && request.method === 'POST') {
      return Response.json(await this.exitPaperPosition(await request.json()));
    }
    if (path === '/test/paper/finish' && request.method === 'POST') {
      const { nowMs } = await request.json();
      return Response.json(await this.markPaperUnverifiable(nowMs));
    }
    if (path === '/test/delivery/init' && request.method === 'POST') {
      const { nowMs } = await request.json();
      await this.storage.transaction(async txn => {
        if (await txn.get('paper-ledger-v1') === undefined) {
          await txn.put('paper-ledger-v1', newPaperLedger(nowMs));
        }
      });
      return Response.json(await this.claimPaperDeliveryRehearsal(nowMs));
    }
    if (path === '/test/delivery/claim' && request.method === 'POST') {
      const { nowMs } = await request.json();
      return Response.json(await this.claimPaperDeliveryRehearsal(nowMs));
    }
    if (path === '/test/delivery/settle' && request.method === 'POST') {
      return Response.json(await this.settlePaperDeliveryRehearsal(await request.json()));
    }
    if (path === '/test/delivery/suppress' && request.method === 'POST') {
      return Response.json(await this.suppressPaperDeliveryRehearsal(await request.json()));
    }
    if (path === '/test/delivery/summary') {
      return Response.json(await this.paperDeliveryRehearsalSummary());
    }
    if (path === '/test/delivery/state') {
      return Response.json((await this.storage.get('paper-delivery-v1')) ?? null);
    }
    if (path === '/test/paper/rollback') {
      const before = await this.storage.get('paper-ledger-v1');
      try {
        await this.storage.transaction(async txn => {
          const record = await txn.get('paper-ledger-v1');
          record.accounts.PAPER_50K.cashPaise = 1;
          record.outbox.push({ eventId: 'BAD', kind: 'PAPER_ENTRY', status: 'PENDING' });
          await txn.put('paper-ledger-v1', record);
          throw new Error('synthetic paper transaction abort');
        });
      } catch { /* deliberate rollback */ }
      const after = await this.storage.get('paper-ledger-v1');
      return Response.json({ unchanged: JSON.stringify(before) === JSON.stringify(after) });
    }
    if (path === '/test/pipeline/turn' && request.method === 'POST') {
      return Response.json(await this.processSyntheticMarketTurn(await request.json()));
    }
    if (path === '/test/pipeline/state') {
      return Response.json({ session: await this.storage.get('synthetic-session-v1') ?? null,
        ledger: await this.storage.get('paper-ledger-v1') ?? null,
        marks: await this.storage.get('synthetic-portfolio-marks-v1') ?? null });
    }
    if (path === '/test/pipeline/rollback') {
      const before = await this.storage.get('synthetic-session-v1');
      const ledgerBefore = await this.storage.get('paper-ledger-v1');
      const marksBefore = await this.storage.get('synthetic-portfolio-marks-v1');
      try {
        await this.storage.transaction(async txn => {
          await txn.put('synthetic-session-v1', { schema: 999 });
          await txn.put('paper-ledger-v1', { schema: 999 });
          await txn.put('synthetic-portfolio-marks-v1', { schema: 999 });
          throw new Error('abort synthetic pipeline transaction');
        });
      } catch { /* expected */ }
      return Response.json({ unchanged:
        JSON.stringify(before) === JSON.stringify(await this.storage.get('synthetic-session-v1')) &&
        JSON.stringify(ledgerBefore) === JSON.stringify(await this.storage.get('paper-ledger-v1')) &&
        JSON.stringify(marksBefore) === JSON.stringify(await this.storage.get('synthetic-portfolio-marks-v1')) });
    }
    if (path === '/test/tick') {
      if (!ticked) {
        clock = (await this.storage.get('scheduler-v1')).scheduledAtMs;
        ticked = true;
      }
      return Response.json(await this.alarm());
    }
    if (path === '/test/rollback') {
      const before = await this.storage.getAlarm();
      try {
        await this.storage.transaction(async txn => {
          await txn.put('rollback-check', 'must-not-persist');
          await txn.setAlarm(clock + 999999);
          throw new Error('synthetic transaction abort');
        });
      } catch { /* deliberate abort */ }
      return Response.json({ before, value: await this.storage.get('rollback-check') ?? null,
        alarm: await this.storage.getAlarm() });
    }
    return super.fetch(request);
  }
}
