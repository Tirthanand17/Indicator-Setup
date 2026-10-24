// LOCAL TEST ENTRYPOINT ONLY. Never referenced by deployment configuration.
import worker, { MarketSession } from '../worker.mjs';
import { newPaperLedger } from '../paper-ledger.mjs';
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
