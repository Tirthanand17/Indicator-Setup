import {randomBytes} from 'node:crypto';
import {newPaperLedger,enterPaperBasket,exitPaperPosition} from '../paper-ledger.mjs';
import {newReadOnlyBridge} from '../readonly-paper-bridge.mjs';
import {newPaperDeliveryJournal,claimPaperDelivery,settlePaperDelivery} from '../paper-delivery.mjs';
import {captureObservedPortfolio} from '../observed-portfolio.mjs';
import {reselectOptionPair,claimOptionSnapshot,finishOptionSnapshot,reserveQuoteRequest} from '../option-runtime.mjs';
import {compileNiftyCatalog,selectCatalogPair,claimCatalogFetch,settleCatalogFetch} from '../instrument-catalog.mjs';
import {NSE_FO_CALENDAR_VERSION} from '../alarm-core.mjs';
export const AT=Date.parse('2026-11-02T10:00:00+05:30');
export const secrets={signingSecret:'synthetic-observed-archive-hmac-0123456789-AbCd',encryptionKeyBase64:randomBytes(32).toString('base64')};
const q=(at,bid=100)=>({contract:{symbol:'NIFTY26N0523000CE',kind:'CE',expiry:'2026-11-05',strike:23000,token:12345,lotSize:65},
  bid,ask:bid+.5,bidQuantity:650,askQuantity:650,updatedAtMs:at-1000});
export function fixture() {
  let ledger=enterPaperBasket(newPaperLedger(AT),{signalId:'observed-archive-entry-001',nowMs:AT,quote:q(AT)}).ledger;
  ledger=exitPaperPosition(ledger,{tradeId:ledger.positions[0].tradeId,nowMs:AT+20000,quote:q(AT+20000,170)}).ledger;
  const bridge={...newReadOnlyBridge(),lastOptionTickId:'2026-11-02:136',lastOptionAtMs:AT+20000,totalOptionTicks:2};
  const metrics=captureObservedPortfolio(undefined,newReadOnlyBridge(),newPaperLedger(AT),bridge,ledger,[q(AT+20000)],AT+20000);
  let delivery=newPaperDeliveryJournal(AT+20000);
  const claimed=claimPaperDelivery(delivery,ledger,AT+20000);
  delivery=settlePaperDelivery(claimed.journal,ledger,{...claimed.result,nowMs:AT+20000,
    httpStatus:200,botResponse:{ok:true,result:{message_id:9001}}}).journal;
  delivery=claimPaperDelivery(delivery,ledger,AT+20000).journal;
  const csv=['instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange',
    '55555,1,NIFTY26NOVFUT,NIFTY,0,2026-11-24,0,0.05,65,FUT,NFO-FUT,NFO',
    '12345,1,NIFTY26N0523000CE,NIFTY,0,2026-11-05,23000,0.05,65,CE,NFO-OPT,NFO',
    '12346,1,NIFTY26N0523000PE,NIFTY,0,2026-11-05,23000,0.05,65,PE,NFO-OPT,NFO'].join('\n');
  const catalog=compileNiftyCatalog(csv,AT),pair=selectCatalogPair(catalog,AT,23000);
  const catalogue=settleCatalogFetch(claimCatalogFetch(undefined,'2026-11-02:135',AT).state,'2026-11-02:135',catalog);
  let options=reselectOptionPair(undefined,{tickId:'2026-11-02:135',observedAtMs:AT,pair});
  options=claimOptionSnapshot(options,{tickId:'2026-11-02:136',observedAtMs:AT+20000}).state;
  options=finishOptionSnapshot(options,{tickId:'2026-11-02:136',evidence:{source:'READONLY_OPTION_EVIDENCE_ONLY',
    paperEntryAuthorized:false,telegramAuthorized:false,realOrdersEnabled:false,
    CE:q(AT+20000),PE:{...q(AT+20000),contract:pair.PE}}});
  return {ledger,bridge,delivery,metrics,scheduler:{schema:1,calendarVersion:NSE_FO_CALENDAR_VERSION,
    callbacks:2,totalClaims:2,lastClaimedTickId:'2026-11-02:136',lastObservedAtMs:AT+20000,
    scheduledAtMs:AT+40000,halted:false,status:'PAPER_ONLY',usageDay:'2026-11-02',events:[]},
  market:{schema:1,tickId:'2026-11-02:136',observedAtMs:AT+20000,status:'MARKET_BATCH_OBSERVED'},
  options,pacing:reserveQuoteRequest(undefined,{tickId:'2026-11-02:136',observedAtMs:AT+20000,kind:'MARKET_BATCH'}).state,
  catalogue,recovery:null};
}
