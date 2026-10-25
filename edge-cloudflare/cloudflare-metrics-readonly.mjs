/** Phase36: narrowly scoped, read-only Cloudflare GraphQL analytics probe.
 * NOT a deployment client; never creates resources, sends trades or writes
 * configuration. A caller must explicitly provide an already authorized
 * account-scoped Analytics Read token and a network transport.
 */
const ENDPOINT='https://api.cloudflare.com/client/v4/graphql';
const MAX_RESPONSE_BYTES=64*1024;
const fail=reason=>{throw Error(`CLOUDFLARE_METRICS_${reason}`);};
const numeric=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const integer=n=>Number.isSafeInteger(n)&&n>=0;

// Fields and datasets from the official Cloudflare GraphQL analytics docs.
const WORKER_QUERY=`query GetWorkersAnalytics($accountTag: string, $datetimeStart: string, $datetimeEnd: string, $scriptName: string) {
  viewer { accounts(filter: {accountTag: $accountTag}) {
    workersInvocationsAdaptive(limit: 100, filter: {
      scriptName: $scriptName, datetime_geq: $datetimeStart, datetime_leq: $datetimeEnd
    }) { sum { requests errors subrequests }
      quantiles { cpuTimeP50 cpuTimeP99 }
      dimensions { datetime scriptName status } }
  } }
}`;
const DURABLE_QUERY=`query GetDurableAccountAnalytics($accountTag: string, $previousDate: string) {
  viewer { accounts(filter: {accountTag: $accountTag}) {
    durableObjectsInvocationsAdaptiveGroups(filter: {date_gt: $previousDate}, limit: 1000) {
      sum { requests responseBodySize } }
    durableObjectsPeriodicGroups(filter: {date_gt: $previousDate}, limit: 1000) {
      sum { cpuTime } }
    durableObjectsStorageGroups(filter: {date_gt: $previousDate}, limit: 1000) {
      max { storedBytes } }
  } }
}`;

function validWindow(start,end){
  if(typeof start!=='string'||typeof end!=='string'||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(start)||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(end)) return false;
  const a=Date.parse(start),b=Date.parse(end);
  return Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&
    new Date(a).toISOString()===start&&new Date(b).toISOString()===end&&
    b>a&&b-a<=24*3600_000;
}

/** Returned requests contain no bearer credential and are not executed here.
 * Durable Objects metrics are account-wide unless the owner verifies that
 * no other namespaces share the account; never label them project-only.
 */
export function cloudflareMetricQueries({accountTag,scriptName='nifty-paper-scheduler',
  datetimeStart,datetimeEnd}={}){
  if(typeof accountTag!=='string'||!/^[a-f0-9]{32}$/i.test(accountTag)||
      scriptName!=='nifty-paper-scheduler'||
      !validWindow(datetimeStart,datetimeEnd)) fail('INVALID_SCOPE');
  const previous=new Date(Date.parse(datetimeStart)-24*3600_000)
    .toISOString().slice(0,10);
  return Object.freeze({
    worker:Object.freeze({query:WORKER_QUERY,variables:{accountTag,scriptName,
      datetimeStart,datetimeEnd}}),
    durableAccount:Object.freeze({query:DURABLE_QUERY,
      variables:{accountTag,previousDate:previous}}),
  });
}

async function boundedJson(response){
  const type=response.headers?.get('content-type')??'';
  if(!/^application\/json(?:\s*;|\s*$)/i.test(type)||
      !response.body?.getReader) fail('INVALID_RESPONSE');
  const reader=response.body.getReader();
  const chunks=[];let len=0;
  try {
    for(;;){
      const {done,value}=await reader.read();
      if(done) break;
      if(!(value instanceof Uint8Array)||
          (len+=value.byteLength)>MAX_RESPONSE_BYTES){
        await reader.cancel();fail('INVALID_RESPONSE');
      }
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const all=new Uint8Array(len);let offset=0;
  for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}
  catch {fail('INVALID_RESPONSE');}
}

async function execute(payload,apiToken,fetchImpl,timeoutMs){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try {
    const response=await fetchImpl(ENDPOINT,{method:'POST',redirect:'manual',
      signal:ctrl.signal,headers:{Authorization:`Bearer ${apiToken}`,
        Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify(payload)});
    if(!response||response.status!==200) fail('BLOCKED_RESPONSE');
    const data=await boundedJson(response);
    if(!data||typeof data!=='object'||Array.isArray(data)||
        (Array.isArray(data.errors)&&data.errors.length)||
        !Array.isArray(data.data?.viewer?.accounts)||
        data.data.viewer.accounts.length!==1) fail('BLOCKED_RESPONSE');
    return data.data.viewer.accounts[0];
  }catch{fail('BLOCKED_RESPONSE');}
  finally {clearTimeout(timer);}
}

/** Only sanitized numerical aggregates leave this function. A successful
 * query is still NOT proof of quotas, CPU unit conversion or approval.
 */
export async function probeCloudflareReadOnlyMetrics({accountTag,
  scriptName='nifty-paper-scheduler',datetimeStart,datetimeEnd,apiToken,
  fetchImpl,timeoutMs=4000}={}){
  const payloads=cloudflareMetricQueries({accountTag,scriptName,datetimeStart,datetimeEnd});
  if(typeof apiToken!=='string'||!/^[A-Za-z0-9_-]{30,256}$/.test(apiToken)||
      typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||
      timeoutMs<250||timeoutMs>4000) fail('INVALID_CLIENT');
  // Never retry a failed query automatically, even after an unknown timeout.
  const worker=await execute(payloads.worker,apiToken,fetchImpl,timeoutMs);
  const durable=await execute(payloads.durableAccount,apiToken,fetchImpl,timeoutMs);
  const invocation=worker.workersInvocationsAdaptive;
  const durableRows=durable.durableObjectsInvocationsAdaptiveGroups;
  const periodic=durable.durableObjectsPeriodicGroups;
  const stored=durable.durableObjectsStorageGroups;
  if(!Array.isArray(invocation)||invocation.length>100||
      !Array.isArray(durableRows)||durableRows.length>1000||
      !Array.isArray(periodic)||periodic.length>1000||
      !Array.isArray(stored)||stored.length>1000) fail('INVALID_METRICS');
  let workerRequests=0,workerErrors=0,subrequests=0,cpuP99Max=null;
  for(const row of invocation){
    if(row?.dimensions?.scriptName!==scriptName||
        !integer(row.sum?.requests)||!integer(row.sum?.errors)||
        !integer(row.sum?.subrequests)||row.sum.errors>row.sum.requests||
        !numeric(row.quantiles?.cpuTimeP50)||
        !numeric(row.quantiles?.cpuTimeP99)||
        row.quantiles.cpuTimeP50>row.quantiles.cpuTimeP99)
      fail('INVALID_METRICS');
    workerRequests+=row.sum.requests;workerErrors+=row.sum.errors;
    subrequests+=row.sum.subrequests;
    cpuP99Max=Math.max(cpuP99Max??0,row.quantiles.cpuTimeP99);
  }
  let durableRequests=0,durableCpuRaw=0,accountMaxStoredBytes=0;
  for(const row of durableRows){
    if(!integer(row?.sum?.requests)||!integer(row?.sum?.responseBodySize))
      fail('INVALID_METRICS');
    durableRequests+=row.sum.requests;
  }
  for(const row of periodic){
    if(!numeric(row?.sum?.cpuTime)) fail('INVALID_METRICS');
    durableCpuRaw+=row.sum.cpuTime;
  }
  for(const row of stored){
    if(!integer(row?.max?.storedBytes)) fail('INVALID_METRICS');
    accountMaxStoredBytes=Math.max(accountMaxStoredBytes,row.max.storedBytes);
  }
  if(![workerRequests,workerErrors,subrequests,durableRequests,
    accountMaxStoredBytes].every(Number.isSafeInteger)||
    !numeric(durableCpuRaw))
    fail('INVALID_METRICS');
  return Object.freeze({status:workerRequests>0?
    'READONLY_METRICS_OBSERVED_NOT_ACCEPTED':'NO_WORKER_TRAFFIC',
    worker:Object.freeze({requests:workerRequests,errors:workerErrors,
      subrequests,cpuTimeP99GraphqlRawMax:cpuP99Max}),
    durableAccount:Object.freeze({scope:'ACCOUNT_WIDE_NOT_PROJECT_PROOF',
      requests:durableRequests,cpuTimeGraphqlRawSum:durableCpuRaw,
      maxStoredBytes:accountMaxStoredBytes}),
    measurementLimitations:Object.freeze([
      'RAW_CPU_UNITS_REQUIRE_DASHBOARD_VERIFICATION',
      'ADAPTIVE_GRAPHQL_METRICS_MAY_BE_SAMPLED',
      'WORKER_QUERY_LIMIT_100_MAY_TRUNCATE_RESULTS',
      'DO_ACCOUNT_METRICS_MAY_INCLUDE_OTHER_NAMESPACES',
      'DO_DATE_QUERY_HAS_NO_EXPLICIT_END_BOUND',
      'NO_DO_BILLED_ROW_COUNTS_IN_THIS_QUERY',
      'LIVE_TEST_REQUIRES_OWNER_DEPLOYMENT_APPROVAL',
    ]),releaseAuthorized:false,realOrdersEnabled:false});
}
