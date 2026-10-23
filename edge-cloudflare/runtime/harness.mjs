// LOCAL TEST ENTRYPOINT ONLY. Never referenced by deployment configuration.
import worker, { MarketSession } from '../worker.mjs';
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
