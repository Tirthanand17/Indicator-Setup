/** Offline-only wall-clock profile of real local workerd/SQLite callbacks.
 * Worker CPU, Cloudflare billable rows and DO GB-seconds cannot be inferred
 * from Node or Miniflare latency, irrespective of how low the times are.
 */
const validCount = (n,max=1125) => Number.isSafeInteger(n) && n>=0 && n<=max;
const percentile = (sorted,p) => sorted[Math.ceil(sorted.length*p)-1];

export function summarizeOfflineCapacity({latenciesMs,expectedCallbacks,
  verifiedClaims,claimsAfterRestart,localSQLiteBytes,outboundAttempts}={}) {
  if(!Array.isArray(latenciesMs) || latenciesMs.length<32 ||
      latenciesMs.length>1125 ||
      !latenciesMs.every(n=>Number.isFinite(n)&&n>=0&&n<=60_000) ||
      !validCount(expectedCallbacks) || expectedCallbacks!==latenciesMs.length ||
      !validCount(verifiedClaims) || !validCount(claimsAfterRestart) ||
      !validCount(localSQLiteBytes,10_000_000_000) ||
      !validCount(outboundAttempts,1000)) throw Error('INVALID_OFFLINE_CAPACITY_INPUT');
  const sorted=[...latenciesMs].sort((a,b)=>a-b);
  const stable=verifiedClaims===expectedCallbacks &&
    claimsAfterRestart===verifiedClaims && outboundAttempts===0;
  return Object.freeze({schema:1,status:stable?
    'OFFLINE_NATIVE_BASELINE_ONLY':'BLOCKED_OFFLINE_INTEGRITY_FAILURE',
    callbacks:expectedCallbacks,uniqueClaims:verifiedClaims,
    recoveredClaims:claimsAfterRestart,unapprovedNetworkAttempts:outboundAttempts,
    local: Object.freeze({platform:'MINIFLARE_WORKERD_SQLITE',
      workload:'SCHEDULER_ONLY_NO_KITE_NO_TELEGRAM',
      callbackWallMs:Object.freeze({min:+sorted[0].toFixed(3),
        p50:+percentile(sorted,0.50).toFixed(3),
        p95:+percentile(sorted,0.95).toFixed(3),
        p99:+percentile(sorted,0.99).toFixed(3),
        max:+sorted.at(-1).toFixed(3)}),
      sqliteDiskBytes:localSQLiteBytes}),
    production:Object.freeze({measuredCloudWorkerCpuMs:null,
      measuredCloudDurableObjectDurationGbSeconds:null,
      measuredCloudSqlRowsRead:null,measuredCloudSqlRowsWritten:null,
      measuredCloudDataTransferBytes:null,realTelegramReceived:false,
      realKiteQuotesVerified:false,liveAcceptancePassed:false}),
    releaseAuthorized:false,realOrdersEnabled:false,
    interpretation:'Local end-to-end wall time is not cloud CPU time or billable duration; production quota eligibility remains unverified.'});
}
