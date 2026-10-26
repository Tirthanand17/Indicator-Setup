import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCloudflareIdentity} from './cloudflare-identity-readonly.mjs';
import {runIdentityCLI} from './cloudflare-identity-cli.mjs';
import {INERT_RUNTIME_FLAGS} from './free-tier-preflight.mjs';

// Public predictable fixtures only. No account or credential is contacted.
const scope={accountId:'0123456789abcdef0123456789abcdef',namespaceId:'abcdef0123456789abcdef0123456789',
  versionId:'11111111-2222-3333-4444-555555555555',scriptEtag:'a'.repeat(64),scriptName:'nifty-paper-scheduler'};
const deploymentId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const secret='SYNTHETIC_IDENTITY_READ_TOKEN_0123456789';
function fixture() {
  const bindings=[...INERT_RUNTIME_FLAGS.map(name=>({name,type:'plain_text',text:'false'})),
    {name:'MARKET_SESSION',type:'durable_object_namespace',class_name:'MarketSession',namespace_id:scope.namespaceId}];
  const runtime={compatibility_date:'2026-07-30',compatibility_flags:[],migration_tag:'v1'};
  return {deployment:{deployments:[{id:deploymentId,strategy:'percentage',versions:[{version_id:scope.versionId,percentage:100}]}]},
    version:{id:scope.versionId,resources:{bindings:structuredClone(bindings),script:{etag:scope.scriptEtag},script_runtime:runtime},
      metadata:{author_email:'private@example.invalid',annotations:{note:secret}}},
    settings:{...structuredClone(runtime),bindings},
    namespace:[{id:scope.namespaceId,class:'MarketSession',script:scope.scriptName,use_sqlite:true}],
    info:{page:1,per_page:1000,total_pages:1,total_count:1,count:1},
    subdomain:{enabled:false,previews_enabled:false},logging:{logpush:false,observability:{enabled:false},tail_consumers:[]}};
}
function transport(data=fixture(), mutate=()=>{}) {
  const calls=[];
  const fetchImpl=async(url,options)=>{
    assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.body,undefined);
    assert.equal(options.headers.Authorization,'Bearer '+secret);
    const u=new URL(url);assert.equal(u.origin,'https://api.cloudflare.com');
    assert.ok(u.pathname.startsWith(`/client/v4/accounts/${scope.accountId}/workers/`));
    calls.push(u.pathname+u.search);mutate(data,calls.length,u);
    let result;
    if(u.pathname.endsWith('/deployments'))result=data.deployment;
    else if(u.pathname.endsWith('/versions/'+scope.versionId))result=data.version;
    else if(u.pathname.endsWith('/script-settings'))result=data.logging;
    else if(u.pathname.endsWith('/settings'))result=data.settings;
    else if(u.pathname.endsWith('/subdomain'))result=data.subdomain;
    else if(u.pathname.endsWith('/namespaces'))return Response.json({success:true,errors:[],result:data.namespace,result_info:data.info});
    else assert.fail('Unexpected endpoint');
    return Response.json({success:true,errors:[],result});
  };
  return {calls,fetchImpl};
}
const inspect=options=>inspectCloudflareIdentity({scope,apiToken:secret,...options});
const cliEnv={CLOUDFLARE_IDENTITY_READ_APPROVED:'yes',CLOUDFLARE_IDENTITY_ACCOUNT_ID:scope.accountId,
  CLOUDFLARE_IDENTITY_NAMESPACE_ID:scope.namespaceId,CLOUDFLARE_IDENTITY_VERSION_ID:scope.versionId,
  CLOUDFLARE_IDENTITY_SCRIPT_ETAG:scope.scriptEtag,CLOUDFLARE_IDENTITY_READ_TOKEN:secret};

test('exact pinned version and SQLite metadata yield a redacted, nonauthorizing observation',async()=>{
  const t=transport(),report=await inspect(t);
  assert.equal(t.calls.length,8);assert.equal(report.apiGetRequests,8);
  assert.equal(report.observed.disabledRuntimeFlags,INERT_RUNTIME_FLAGS.length);
  assert.equal(report.observed.sqliteNamespaceMatches,true);
  assert.equal(report.status,'METADATA_OBSERVED_NOT_DEPLOYMENT_ACCEPTED');
  for(const key of ['freePlanVerified','noCardEligibilityVerified','sourceBundleVerified','deploymentAccepted','releaseAuthorized','realOrdersEnabled','snapshotIsAtomic'])
    assert.equal(report[key],false);
  const printed=JSON.stringify(report);
  for(const value of [secret,scope.accountId,scope.namespaceId,scope.versionId,deploymentId,scope.scriptEtag,'private@example.invalid'])
    assert.equal(printed.includes(value),false);
});
test('scope/path injection, wrong Worker and missing credentials cannot make a request',async()=>{
  const fetchImpl=()=>assert.fail('No HTTP permitted');
  for(const invalid of [{...scope,accountId:'../other'},{...scope,scriptName:'legacy-worker'},
    {...scope,versionId:'latest'},{...scope,namespaceId:'https://example.invalid'}, {...scope,scriptEtag:'unverified'}])
    await assert.rejects(inspect({scope:invalid,fetchImpl}),/CLOUDFLARE_IDENTITY_BLOCKED/);
  await assert.rejects(inspect({apiToken:'',fetchImpl}),/BLOCKED/);
});
test('split rollout, old version, unexpected flags, extra resources and namespace mismatches fail closed',async()=>{
  const mutations=[
    d=>{d.deployment.deployments=[];},d=>{d.deployment.deployments[0].versions[0].percentage=50;},
    d=>{d.deployment.deployments[0].versions.push(d.deployment.deployments[0].versions[0]);},
    d=>{d.version.id=deploymentId;},d=>{d.version.resources.script.etag='b'.repeat(64);},
    d=>{d.version.resources.script_runtime.migration_tag='v2';},
    d=>{d.settings.bindings[0].text='true';},d=>{d.settings.bindings[0].text=false;},
    d=>{d.settings.bindings.pop();},d=>{d.settings.bindings.push({name:'SECRET',type:'secret_text',text:secret});},
    d=>{d.settings.bindings[1]=d.settings.bindings[0];},
    d=>{d.settings.bindings.at(-1).namespace_id=scope.accountId;},
    d=>{d.settings.bindings.at(-1).script_name='other-worker';},
    d=>{d.settings.compatibility_flags=['nodejs_compat'];},
    d=>{d.settings.exports={MarketSession:{type:'durable-object',storage:'kv'}};},
    d=>{d.namespace[0].use_sqlite=false;},d=>{d.namespace[0].class='Other';},
    d=>{d.namespace[0].script='legacy-worker';},d=>{d.namespace=[];d.info.total_count=0;d.info.count=0;},
    d=>{d.namespace.push(d.namespace[0]);d.info.total_count=2;d.info.count=2;},
    d=>{d.info.total_pages=2;},d=>{delete d.info.total_count;},
    d=>{d.subdomain.enabled=true;},d=>{d.subdomain.previews_enabled=true;},
    d=>{d.logging.observability.enabled=true;},d=>{delete d.logging.logpush;},
    d=>{d.logging.tail_consumers=[{service:secret}];},
  ];
  for(const mutate of mutations){const d=fixture();mutate(d);await assert.rejects(inspect(transport(d)),/CLOUDFLARE_IDENTITY_BLOCKED/);}
});
test('concurrent deployment or settings changes invalidate the sequential observation',async()=>{
  for(const mutate of [
    (d,n)=>{if(n===7)d.deployment.deployments[0].id=scope.versionId;},
    (d,n)=>{if(n===8)d.settings.bindings[0].text='true';},
  ])await assert.rejects(inspect(transport(fixture(),mutate)),/BLOCKED/);
});
test('403, redirects, malformed/oversized JSON and provider messages expose no response or secret',async()=>{
  const responses=[()=>new Response(secret,{status:403}),()=>new Response(secret,{status:302,headers:{location:'https://example.invalid'}}),
    ()=>new Response('{'+secret,{headers:{'content-type':'application/json'}}),
    ()=>Response.json({success:false,errors:[{message:secret}],result:{}}),
    ()=>Response.json({success:true,errors:[],result:secret.repeat(15_000)}),
    ()=>Response.json({success:true,result:{}}),()=>new Response('not-json')];
  for(const response of responses){let calls=0;
    await assert.rejects(inspect({fetchImpl:async()=>{calls++;return response();}}),
      error=>error.message==='CLOUDFLARE_IDENTITY_BLOCKED'&&!error.cause);
    assert.equal(calls,1);
  }
});
test('fetch and streaming deadlines bound even a fake transport ignoring abort, with no retries',async()=>{
  for(const fetchImpl of [()=>new Promise(()=>{}),async()=>new Response(new ReadableStream(),{headers:{'content-type':'application/json'}})])
    await assert.rejects(inspect({fetchImpl,timeoutMs:20}),/BLOCKED/);
});
test('CLI defaults to zero HTTP and requires explicit approval even with a configured environment',async()=>{
  const output=[],never=()=>assert.fail('No HTTP permitted');
  for(const args of [[],['--help']])assert.equal(await runIdentityCLI(args,{env:cliEnv,fetchImpl:never,log:v=>output.push(v)}),0);
  assert.equal(await runIdentityCLI(['--run'],{env:{...cliEnv,CLOUDFLARE_IDENTITY_READ_APPROVED:'no'},fetchImpl:never,log:v=>output.push(v)}),1);
  assert.equal(await runIdentityCLI(['--deploy'],{env:cliEnv,fetchImpl:never,log:v=>output.push(v)}),1);
  assert.equal(output.join('\n').includes(secret),false);
});
test('CLI metadata success is exit 2 and cannot certify deployment or Free-plan eligibility',async()=>{
  const output=[],t=transport();
  assert.equal(await runIdentityCLI(['--run'],{env:cliEnv,fetchImpl:t.fetchImpl,log:v=>output.push(v)}),2);
  assert.equal(JSON.parse(output[0]).deploymentAccepted,false);assert.equal(t.calls.length,8);
  output.length=0;
  assert.equal(await runIdentityCLI(['--run'],{env:cliEnv,fetchImpl:()=>{throw Error(secret);},log:v=>output.push(v)}),1);
  assert.deepEqual(output,['CLOUDFLARE_IDENTITY_BLOCKED_SAFE_FAILURE']);
});
