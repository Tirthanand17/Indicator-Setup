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
