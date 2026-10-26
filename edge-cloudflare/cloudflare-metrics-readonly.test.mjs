import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudflareMetricQueries,probeCloudflareReadOnlyMetrics } from './cloudflare-metrics-readonly.mjs';

const tag='0123456789abcdef0123456789abcdef';
const secret='FAKE_ANALYTICS_READ_ONLY_TOKEN_0123456789abcdef';
const scope={accountTag:tag,scriptName:'nifty-paper-scheduler',
  datetimeStart:'2026-10-23T00:00:00.000Z',
  datetimeEnd:'2026-10-24T00:00:00.000Z'};
const workerRows=[{sum:{requests:4,errors:0,subrequests:1},
  quantiles:{cpuTimeP50:100,cpuTimeP99:250},
  dimensions:{datetime:'2026-10-23T09:20:00Z',scriptName:'nifty-paper-scheduler',
    status:'success'}}];
const workerReply={data:{viewer:{accounts:[{workersInvocationsAdaptive:workerRows}]}}};
const durableReply={data:{viewer:{accounts:[{
  durableObjectsInvocationsAdaptiveGroups:[{sum:{requests:4,responseBodySize:256}}],
  durableObjectsPeriodicGroups:[{sum:{cpuTime:3.25}}],
  durableObjectsStorageGroups:[{max:{storedBytes:2097152}}],
}]}}};

test('queries follow pinned official read-only datasets and one-day scope',()=>{
  const queries=cloudflareMetricQueries(scope);
  assert.match(queries.worker.query,/workersInvocationsAdaptive/);
  assert.match(queries.worker.query,/cpuTimeP99/);
  assert.match(queries.durableAccount.query,/durableObjectsStorageGroups/);
  assert.equal(queries.worker.variables.scriptName,'nifty-paper-scheduler');
  assert.equal(queries.durableAccount.variables.previousDate,'2026-10-22');
  for(const bad of [
    {...scope,accountTag:'not-an-id'},
    {...scope,scriptName:'other-worker'},
    {...scope,datetimeStart:'2026-10-23'},
    {...scope,datetimeEnd:'2026-10-27T00:00:00.000Z'},
    {...scope,datetimeEnd:scope.datetimeStart},
    {...scope,datetimeStart:'2026-02-30T00:00:00.000Z'},
  ]) assert.throws(()=>cloudflareMetricQueries(bad),/INVALID_SCOPE/);
});

test('two fake GraphQL responses produce only sanitized, non-authorizing metrics',async()=>{
  let n=0;
  const fetchImpl=async(url,options)=>{
    n++;
    assert.equal(url,'https://api.cloudflare.com/client/v4/graphql');
    assert.equal(options.method,'POST');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,`Bearer ${secret}`);
    const request=JSON.parse(options.body);
    assert.equal(request.variables.accountTag,tag);
    assert.ok(request.query.includes(n===1?'workersInvocationsAdaptive':
      'durableObjectsStorageGroups'));
    return Response.json(n===1?workerReply:durableReply);
  };
  const report=await probeCloudflareReadOnlyMetrics({...scope,apiToken:secret,fetchImpl});
  assert.equal(n,2);
  assert.equal(report.status,'READONLY_METRICS_OBSERVED_NOT_ACCEPTED');
  assert.equal(report.worker.requests,4);
  assert.equal(report.worker.cpuTimeP99GraphqlRawMax,250);
  assert.equal(report.durableAccount.maxStoredBytes,2097152);
  assert.equal(report.durableAccount.cpuTimeGraphqlRawSum,3.25);
  assert.equal(report.durableAccount.scope,'ACCOUNT_WIDE_NOT_PROJECT_PROOF');
  assert.equal(report.releaseAuthorized,false);
  assert.equal(report.realOrdersEnabled,false);
  assert.equal(JSON.stringify(report).includes(secret),false);
  assert.equal(JSON.stringify(report).includes(tag),false);
});

test('absent traffic is not converted into a successful production measurement',async()=>{
  let n=0;
  const fetchImpl=async()=>Response.json(++n===1?
    {data:{viewer:{accounts:[{workersInvocationsAdaptive:[]}]}}}:
    {data:{viewer:{accounts:[{
      durableObjectsInvocationsAdaptiveGroups:[],durableObjectsPeriodicGroups:[],
      durableObjectsStorageGroups:[]}]}}});
  const result=await probeCloudflareReadOnlyMetrics({...scope,apiToken:secret,fetchImpl});
  assert.equal(result.status,'NO_WORKER_TRAFFIC');
  assert.equal(result.worker.cpuTimeP99GraphqlRawMax,null);
  assert.equal(result.releaseAuthorized,false);
});

test('auth failure, API errors, malformed JSON and foreign script fail closed',async()=>{
  const badResponses=[
    ()=>Response.json({errors:[{message:'sensitive account details'}]}, {status:200}),
    ()=>Response.json({error:'secret'}, {status:403}),
    ()=>new Response('<html>broken</html>',{status:200,
      headers:{'Content-Type':'text/html'}}),
    ()=>Response.json({data:{viewer:{accounts:[]}}}),
    ()=>Response.json({data:{viewer:{accounts:[{
      workersInvocationsAdaptive:[{...workerRows[0],
        dimensions:{...workerRows[0].dimensions,scriptName:'unrelated'}}],
    }]}}}),
    ()=>Response.json({data:{viewer:{accounts:[{
      workersInvocationsAdaptive:workerRows.map(r=>({...r,
        sum:{...r.sum,errors:99}})),
    }]}}}),
  ];
  for(const bad of badResponses){
    const fetchImpl=async()=>bad();
    await assert.rejects(()=>probeCloudflareReadOnlyMetrics({...scope,
      apiToken:secret,fetchImpl}),/CLOUDFLARE_METRICS_(?:BLOCKED_RESPONSE|INVALID_METRICS)/);
  }
  await assert.rejects(()=>probeCloudflareReadOnlyMetrics({...scope,
    apiToken:'bad',fetchImpl:async()=>{throw Error('must not be called');}}),
  /INVALID_CLIENT/);
});

test('aborted fake HTTP is never retried or treated as telemetry',async()=>{
  let attempts=0;
  await assert.rejects(()=>probeCloudflareReadOnlyMetrics({...scope,
    apiToken:secret,timeoutMs:250,fetchImpl:async(_url,options)=>{
      attempts++;
      return new Promise((_resolve,reject)=>{
        options.signal.addEventListener('abort',()=>reject(Error('injected timeout')),
          {once:true});
      });
    }}),/BLOCKED_RESPONSE/);
  assert.equal(attempts,1);
});
