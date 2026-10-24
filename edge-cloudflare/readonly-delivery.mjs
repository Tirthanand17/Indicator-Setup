/** Offline read-only Kite-paper delivery journal boundary.
 * Reuses the Phase24 uncertainty state machine, but never shares its cursor
 * with the entirely separate synthetic portfolio and never sends a message.
 */
import { auditPaperLedger } from './paper-ledger.mjs';
import { newPaperDeliveryJournal, auditPaperDelivery } from './paper-delivery.mjs';

export const READONLY_PAPER_DELIVERY_KEY='readonly-paper-delivery-v1';

/** Called inside the same SQLite transaction as paper ledger mutation.
 * A missing cursor alongside historical outbox events is NOT safe to start
 * from index zero: such a restore could resend already accepted messages.
 */
export function reconcileReadOnlyDeliveryJournal(stored,oldLedger,nextLedger,nowMs) {
  if(oldLedger!==undefined) auditPaperLedger(oldLedger);
  auditPaperLedger(nextLedger);
  if(stored===undefined) {
    if(oldLedger?.outbox.length) throw Error('READONLY_DELIVERY_MISSING_REPLAY_WATERMARK');
    return newPaperDeliveryJournal(nowMs);
  }
  if(oldLedger===undefined) throw Error('READONLY_DELIVERY_ORPHAN_JOURNAL');
  auditPaperDelivery(stored,oldLedger);
  auditPaperDelivery(stored,nextLedger);
  return stored;
}
