import {openObservedArchive,readObservedStateInTransaction} from './observed-archive.mjs';
import {OBSERVED_LIFECYCLE_KEY,RETENTION_POLICY,auditObservedLifecycle} from './observed-lifecycle.mjs';

/** Metadata-only upgrade after halt and a matching authenticated rollback artifact. */
export async function migrateObservedLifecycle(storage,{nowMs,...options}) {
  const verified=await openObservedArchive(options);
  if(!Number.isSafeInteger(nowMs)||nowMs<verified.createdAtMs)throw Error('LIFECYCLE_BAD_CLOCK');
  return storage.transaction(async txn=>{
    const current=await readObservedStateInTransaction(storage,txn,nowMs);
    if(!current.scheduler?.halted||current.scheduler.scheduledAtMs!==null||await txn.getAlarm()!==null)
      throw Error('LIFECYCLE_REQUIRES_HALTED_SOURCE');
    if(current.lifecycle!==null) {
      auditObservedLifecycle(current.lifecycle);
      if(current.lifecycle.baselineArchiveId!==verified.archiveId)throw Error('LIFECYCLE_BASELINE_CONFLICT');
      return {status:'LIFECYCLE_ALREADY_MIGRATED',baselineArchiveId:verified.archiveId};
    }
    if(JSON.stringify(current)!==JSON.stringify(verified.state))throw Error('LIFECYCLE_ARCHIVE_NOT_CURRENT');
    const manifest={schema:1,writerVersion:1,minimumReaderVersion:1,retentionPolicy:RETENTION_POLICY,
      migratedAtMs:nowMs,baselineArchiveId:verified.archiveId};
    await txn.put(OBSERVED_LIFECYCLE_KEY,manifest);
    return {status:'LIFECYCLE_MIGRATED_HALTED',baselineArchiveId:verified.archiveId,businessRecordsChanged:false};
  });
}
