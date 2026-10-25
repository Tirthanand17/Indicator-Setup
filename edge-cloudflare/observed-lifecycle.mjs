/** Version gate and non-destructive retention policy for observed journals. */
import {auditPaperLedger} from './paper-ledger.mjs';
export const OBSERVED_LIFECYCLE_KEY='readonly-lifecycle-v1';
export const RETENTION_POLICY='PRESERVE_FINANCIAL_HALT_AT_CAP_V1';
export function auditObservedLifecycle(value) {
  if(value===undefined||value===null)return true; // Explicitly supported legacy stores.
  if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==
    'baselineArchiveId,migratedAtMs,minimumReaderVersion,retentionPolicy,schema,writerVersion'||
    value.schema!==1||value.writerVersion!==1||value.minimumReaderVersion!==1||
    value.retentionPolicy!==RETENTION_POLICY||!Number.isSafeInteger(value.migratedAtMs)||value.migratedAtMs<=0||
    typeof value.baselineArchiveId!=='string'||!/^[a-f0-9]{64}$/.test(value.baselineArchiveId))
    throw Error('OBSERVED_LIFECYCLE_INCOMPATIBLE_SCHEMA');
  return true;
}
export async function assertObservedWriter(storage) {
  const value=await storage.get(OBSERVED_LIFECYCLE_KEY);
  if(value===null)throw Error('OBSERVED_LIFECYCLE_INCOMPATIBLE_SCHEMA');
  auditObservedLifecycle(value);
}
export function observedRetentionReport(state) {
  auditObservedLifecycle(state.lifecycle);
  const l=state.ledger;
  auditPaperLedger(l);
  const rows=[['positions',l.positions.length,512],['rejections',l.rejections.length,1024],['outbox',l.outbox.length,1024]]
    .map(([kind,used,limit])=>({kind,used,limit,remaining:limit-used,
      status:used>=limit?'AT_LIMIT':used>=Math.ceil(limit*.9)?'CRITICAL':used>=Math.ceil(limit*.75)?'WARNING':'OK',
      retention:'PRESERVE_ALL_NO_AUTOMATIC_PRUNING'}));
  const active=l.positions.filter(p=>p.status!=='CLOSED').length;
  const levels=['OK','WARNING','CRITICAL','AT_LIMIT'];
  return {status:state.lifecycle?'CURRENT_SCHEMA':'SUPPORTED_LEGACY_SCHEMA',retentionPolicy:RETENTION_POLICY,
    capacityStatus:levels[Math.max(...rows.map(r=>levels.indexOf(r.status)))],
    newEntriesBlocked:rows.some(r=>r.status==='AT_LIMIT')||1024-l.outbox.length-active<2,
    rows,activePositions:active,reservedTerminalEvents:active,
    entryEventRoom:Math.max(0,Math.floor((1024-l.outbox.length-active)/2)),
    exitEventRoomAvailable:1024-l.outbox.length>=active,
    diagnosticRings:{bridgeEvents:128,deliveryReceipts:128,equitySamplesPerAccount:128,schedulerEvents:128},
    fullFinancialHistoryPruned:false,automaticDeletion:false,automaticRollover:false,
    rollbackPolicy:'VERIFIED_ARCHIVE_TO_EMPTY_QUARANTINED_TARGET_ONLY',
    baselineArchiveId:state.lifecycle?.baselineArchiveId??null,
    serializedStateBytes:new TextEncoder().encode(JSON.stringify(state)).length};
}
