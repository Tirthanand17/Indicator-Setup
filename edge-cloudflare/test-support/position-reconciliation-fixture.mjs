import {fixture,AT,secrets} from './observed-archive-fixture.mjs';
import {newPaperLedger,enterPaperBasket,markPaperUnverifiable} from '../paper-ledger.mjs';
import {newReadOnlyBridge} from '../readonly-paper-bridge.mjs';
import {captureObservedPortfolio} from '../observed-portfolio.mjs';
export {secrets,AT};
export const EOD=Date.parse('2026-11-02T15:26:00+05:30');
export function unresolvedFixture({both=false,carried=false}={}) {
  const state=fixture();
  if(both)state.ledger=enterPaperBasket(newPaperLedger(AT),{signalId:'observed-archive-entry-001',nowMs:AT,
    quote:{contract:state.options.pair.CE,bid:100,ask:100.5,bidQuantity:650,askQuantity:650,updatedAtMs:AT-1000}}).ledger;
  if(!carried)state.ledger=markPaperUnverifiable(state.ledger,EOD).ledger;
  state.metrics=captureObservedPortfolio(undefined,newReadOnlyBridge(),newPaperLedger(AT),state.bridge,state.ledger,[],EOD);
  state.scheduler={...state.scheduler,halted:true,scheduledAtMs:null,status:'OWNER_EMERGENCY_HALT',lastObservedAtMs:EOD};
  return state;
}
