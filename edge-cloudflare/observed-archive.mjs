/** Complete observed-paper snapshot. Credentials and executable alarms excluded. */
import {auditPaperLedger} from './paper-ledger.mjs';
import {auditReadOnlyBridge} from './readonly-paper-bridge.mjs';
import {auditPaperDelivery} from './paper-delivery.mjs';
import {observedPortfolioMetrics} from './observed-portfolio.mjs';
import {validateOptionRuntime,validateQuotePace} from './option-runtime.mjs';
import {auditCatalogState} from './instrument-catalog.mjs';
import {validState,validMarketObservation} from './runtime-state.mjs';
import {NSE_FO_CALENDAR_VERSION} from './alarm-core.mjs';
import {OBSERVED_LIFECYCLE_KEY,auditObservedLifecycle} from './observed-lifecycle.mjs';

export const OBSERVED_RECOVERY_KEY='readonly-recovery-quarantine-v1';
export const OBSERVED_ARCHIVE_KEYS=Object.freeze({
  ledger:'readonly-paper-ledger-v1',bridge:'readonly-paper-bridge-v1',
  delivery:'readonly-paper-delivery-v1',metrics:'readonly-portfolio-metrics-v1',
  scheduler:'scheduler-v1',market:'market-observation-v1',
  options:'readonly-option-state-v1',pacing:'readonly-quote-pace-v1',
  catalogue:'readonly-instrument-catalog-v1',recovery:OBSERVED_RECOVERY_KEY,lifecycle:OBSERVED_LIFECYCLE_KEY,
});
export const MAX_OBSERVED_CLEAR_BYTES=4_000_000;
export const MAX_OBSERVED_SEALED_BYTES=5_350_000;
const EXCLUDED_KEYS=['daily-token-v1','paper-ledger-v1','synthetic-session-v1',
  'synthetic-portfolio-marks-v1','paper-delivery-v1'];
const DOMAIN='NIFTY_OBSERVED_PAPER_ARCHIVE_V1',SCOPE='nifty-paper-session-v1';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const fail=code=>{throw Error('OBSERVED_ARCHIVE_'+code);};
const time=n=>Number.isSafeInteger(n)&&n>0;
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
const encode=o=>encoder.encode(JSON.stringify(o));
const aad=encoder.encode(DOMAIN);
const secretOk=s=>typeof s==='string'&&s.length>=32&&s.length<=256&&new Set(s).size>=8;
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
function noApplicationSQL(storage) {
  if(storage.sql&&Array.from(storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table'"))
    .some(row=>!['__cf_kv','_cf_KV','_cf_METADATA'].includes(row.name)&&!row.name.startsWith('sqlite_')))
    fail('UNSUPPORTED_APPLICATION_SQL_TABLES');
}

function b64(bytes) {
  const chunks=[];
  for(let i=0;i<bytes.length;i+=16384)chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
  return btoa(chunks.join('')).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function unb64(s,max) {
  if(typeof s!=='string'||!/^[A-Za-z0-9_-]+$/.test(s)||s.length>Math.ceil(max/3)*4)fail('INVALID_ENCODING');
  let raw;
  try {raw=Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}
  catch {fail('INVALID_ENCODING');}
  if(raw.length>max||b64(raw)!==s)fail('INVALID_ENCODING');return raw;
}
async function keys({signingSecret,encryptionKeyBase64}={}) {
  if(!secretOk(signingSecret)||signingSecret===encryptionKeyBase64||
    typeof encryptionKeyBase64!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(encryptionKeyBase64))fail('INVALID_OR_REUSED_KEYS');
  const raw=Uint8Array.from(atob(encryptionKeyBase64),c=>c.charCodeAt(0));
  if(raw.length!==32||btoa(String.fromCharCode(...raw))!==encryptionKeyBase64)fail('INVALID_ENCRYPTION_KEY');
  try {return {
    sign:await crypto.subtle.importKey('raw',encoder.encode(signingSecret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']),
    encrypt:await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']),
  };} finally {raw.fill(0);}
}

function noCredentials(value,depth=0) {
  if(depth>32)fail('INVALID_DOCUMENT_DEPTH');
  if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)) {
    if(/^(?:access_?token|api_?key|authorization|headers|cookie|password|secret|ciphertext|fingerprint|nonces)$/i.test(key))fail('CREDENTIAL_FIELD');
    noCredentials(child,depth+1);
  }
}
export function auditRecoveryMarker(m) {
  if(!exact(m,['schema','archiveId','archiveCreatedAtMs','restoredAtMs','sourceScheduler'])||m.schema!==1||
    typeof m.archiveId!=='string'||!/^[a-f0-9]{64}$/.test(m.archiveId)||!time(m.archiveCreatedAtMs)||
    !time(m.restoredAtMs)||m.restoredAtMs<m.archiveCreatedAtMs||
    (m.sourceScheduler!==null&&!validState(m.sourceScheduler)))fail('INVALID_RECOVERY_MARKER');
}

export function auditObservedArchiveState(state,createdAtMs) {
  if(!exact(state,Object.keys(OBSERVED_ARCHIVE_KEYS))||!time(createdAtMs)||encode(state).length>MAX_OBSERVED_CLEAR_BYTES)
    fail('INCOMPLETE_OR_OVERSIZED_STATE');
  noCredentials(state);
  auditObservedLifecycle(state.lifecycle);
  if(state.lifecycle?.migratedAtMs>createdAtMs)fail('LIFECYCLE_CLOCK');
  auditPaperLedger(state.ledger);auditReadOnlyBridge(state.bridge);
  if(createdAtMs<state.ledger.lastMutationAtMs||
    (state.bridge.lastOptionAtMs!==null&&createdAtMs<state.bridge.lastOptionAtMs)||
    (state.bridge.pending&&createdAtMs<state.bridge.pending.reviewAtMs)||
    (state.ledger.positions.length>0&&state.bridge.totalOptionTicks===0))fail('BOOK_CLOCK_OR_ORPHAN');
  if(state.delivery!==null) {
    auditPaperDelivery(state.delivery,state.ledger);
    if(state.delivery.lastChangedAtMs>createdAtMs)fail('DELIVERY_CLOCK');
  }
  if(state.metrics!==null&&observedPortfolioMetrics(state.ledger,state.bridge,state.metrics,createdAtMs).metricsStatus!=='METRICS_STATE_VERIFIED')
    fail('INVALID_METRICS_BINDING');
  if(state.scheduler!==null&&(!validState(state.scheduler)||state.scheduler.lastObservedAtMs>createdAtMs))fail('INVALID_SCHEDULER');
  if(state.market!==null&&(!validMarketObservation(state.market)||!time(state.market.observedAtMs)||state.market.observedAtMs>createdAtMs))fail('INVALID_MARKET');
  validateOptionRuntime(state.options);validateQuotePace(state.pacing);
  auditCatalogState(state.catalogue===null?undefined:state.catalogue);
  if(state.options?.pair?.masterFetchedAtMs>createdAtMs||state.options?.evidence?.observedAtMs>createdAtMs||
    state.pacing?.lastReservedAtMs>createdAtMs||state.catalogue?.catalog?.fetchedAtMs>createdAtMs||
    state.metrics?.observedAtMs>createdAtMs)fail('OBSERVATION_CLOCK');
  if(state.recovery!==null){auditRecoveryMarker(state.recovery);if(state.recovery.restoredAtMs>createdAtMs)fail('RECOVERY_CLOCK');}
  return true;
}

/** Read all named documents in ONE transaction; do cryptography after release. */
export async function snapshotObservedState(storage,createdAtMs) {
  return storage.transaction(txn=>readObservedStateInTransaction(storage,txn,createdAtMs));
}
export async function readObservedStateInTransaction(storage,txn,createdAtMs) {
    noApplicationSQL(storage);
    const known=new Set([...Object.values(OBSERVED_ARCHIVE_KEYS),...EXCLUDED_KEYS]);
    if([...(await txn.list({limit:known.size+1})).keys()].some(key=>!known.has(key)))fail('UNKNOWN_SOURCE_RECORD');
    const entries=await Promise.all(Object.entries(OBSERVED_ARCHIVE_KEYS).map(async([name,key])=>{
      const value=await txn.get(key);
      if(name==='lifecycle'&&value===null)fail('CORRUPT_STORED_LIFECYCLE');
      return [name,value??null];
    }));
    const state=structuredClone(Object.fromEntries(entries));
    auditObservedArchiveState(state,createdAtMs);return state;
}

export async function sealObservedArchive({state,createdAtMs,...secrets}={}) {
  const snapshot=structuredClone(state);auditObservedArchiveState(snapshot,createdAtMs);
  const payload={format:DOMAIN,schema:2,scope:SCOPE,createdAtMs,state:snapshot};
  const encoded=encode(payload);if(encoded.length>MAX_OBSERVED_CLEAR_BYTES)fail('SIZE_LIMIT');
  const k=await keys(secrets);
  const tag=b64(new Uint8Array(await crypto.subtle.sign('HMAC',k.sign,encoded)));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const clear=encode({payload,tag});
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},k.encrypt,clear);
  return {format:DOMAIN,schema:1,algorithm:'AES-256-GCM+HMAC-SHA256',iv:b64(iv),ciphertext:b64(new Uint8Array(cipher))};
}

export async function openObservedArchive({sealedArchive,...secrets}={}) {
  if(!exact(sealedArchive,['format','schema','algorithm','iv','ciphertext'])||sealedArchive.format!==DOMAIN||
    sealedArchive.schema!==1||sealedArchive.algorithm!=='AES-256-GCM+HMAC-SHA256'||
    encode(sealedArchive).length>MAX_OBSERVED_SEALED_BYTES)fail('INVALID_ENVELOPE');
  const iv=unb64(sealedArchive.iv,12),cipher=unb64(sealedArchive.ciphertext,MAX_OBSERVED_CLEAR_BYTES+1024);
  if(iv.length!==12||cipher.length<17)fail('INVALID_ENVELOPE');
  const k=await keys(secrets);let signed;
  try {signed=JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad},k.encrypt,cipher)));}
  catch {fail('AUTHENTICATION_FAILED');}
  if(!exact(signed,['payload','tag'])||!exact(signed.payload,['format','schema','scope','createdAtMs','state'])||
    signed.payload.format!==DOMAIN||![1,2].includes(signed.payload.schema)||signed.payload.scope!==SCOPE)fail('INVALID_PAYLOAD');
  const encoded=encode(signed.payload),tag=unb64(signed.tag,32);
  if(encoded.length>MAX_OBSERVED_CLEAR_BYTES||tag.length!==32||
    !await crypto.subtle.verify('HMAC',k.sign,tag,encoded))fail('SIGNATURE_MISMATCH');
  const original=signed.payload.state;
  if(signed.payload.schema===1&&!exact(original,Object.keys(OBSERVED_ARCHIVE_KEYS).filter(k=>k!=='lifecycle')))fail('INVALID_V1_STATE');
  const state=signed.payload.schema===1?{...structuredClone(original),lifecycle:null}:structuredClone(original);
  auditObservedArchiveState(state,signed.payload.createdAtMs);
  return {...structuredClone(signed.payload),state,sourcePayloadSchema:signed.payload.schema,
    archiveId:hex(await crypto.subtle.digest('SHA-256',encoded))};
}

export function observedArchiveSummary(verified) {
  const {state,createdAtMs,archiveId}=verified;
  return {status:'VERIFIED_OBSERVED_PAPER_ARCHIVE',archiveId,createdAtMs,paperOnly:true,
    sourcePayloadSchema:verified.sourcePayloadSchema,
    positions:state.ledger.positions.length,outbox:state.ledger.outbox.length,
    deliveryWatermark:state.delivery?.nextIndex??null,
    deliveryReplaySafety:state.delivery?'PRESERVED_CURSOR_AND_UNCERTAINTY':
      state.ledger.outbox.length?'MISSING_WATERMARK_QUARANTINE_REQUIRED':'NO_OUTBOX',
    metricHistory:state.metrics?'PRESERVED':'UNAVAILABLE_IN_SOURCE',
    snapshotOnly:true,credentialsIncluded:false,alarmRestored:false,automaticResume:false};
}

/** A snapshot may precede later external sends. Never resume its delivery queue. */
export async function restoreObservedArchiveToEmpty(storage,{nowMs,...options}={}) {
  const verified=await openObservedArchive(options);
  if(!time(nowMs)||nowMs<verified.createdAtMs)fail('RESTORE_CLOCK');
  return storage.transaction(async txn=>{
    if((await txn.list({limit:1})).size!==0||await txn.getAlarm()!==null)fail('TARGET_NOT_EMPTY');
    noApplicationSQL(storage);
    const state=verified.state;
    const scheduler=state.scheduler??{schema:1,calendarVersion:NSE_FO_CALENDAR_VERSION,
      lastObservedAtMs:nowMs,lastClaimedTickId:null,totalClaims:0,usageDay:new Date(nowMs).toISOString().slice(0,10),callbacks:0,events:[]};
    for(const [name,key] of Object.entries(OBSERVED_ARCHIVE_KEYS))
      if(!['scheduler','recovery'].includes(name)&&state[name]!==null)await txn.put(key,state[name]);
    await txn.put('scheduler-v1',{...scheduler,halted:true,scheduledAtMs:null,
      lastObservedAtMs:nowMs,status:'ARCHIVE_RESTORED_QUARANTINED'});
    await txn.put(OBSERVED_RECOVERY_KEY,{schema:1,archiveId:verified.archiveId,
      archiveCreatedAtMs:verified.createdAtMs,restoredAtMs:nowMs,sourceScheduler:state.scheduler});
    await txn.deleteAlarm();
    return {...observedArchiveSummary(verified),status:'RESTORED_OBSERVED_PAPER_QUARANTINED',restoredAtMs:nowMs};
  });
}

export async function readObservedArchiveJSON(stream) {
  if(!stream)fail('MISSING_BODY');const reader=stream.getReader(),chunks=[];let length=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;
    length+=value.byteLength;if(length>MAX_OBSERVED_SEALED_BYTES){await reader.cancel();fail('SIZE_LIMIT');}chunks.push(value);}
  } finally {reader.releaseLock();}
  const joined=new Uint8Array(length);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
  try {return JSON.parse(decoder.decode(joined));}catch{fail('INVALID_JSON');}
}
