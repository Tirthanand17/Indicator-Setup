/** Fixed-scope GET-only metadata inspection. Never deploys, activates or authorizes release. */
import {INERT_RUNTIME_FLAGS} from './free-tier-preflight.mjs';
import {readBoundedBody} from './ingress.mjs';

const SCRIPT = 'nifty-paper-scheduler';
const ORIGIN = 'https://api.cloudflare.com/client/v4';
const fail = () => {throw Error('CLOUDFLARE_IDENTITY_BLOCKED');};
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const id = v => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const hash = async v => [...new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode('cloud-identity-v1:'+v)))].map(b=>b.toString(16).padStart(2,'0')).join('');

export function validateIdentityScope(scope) {
  if (!object(scope) || !id(scope.accountId) || !id(scope.namespaceId) ||
      !uuid(scope.versionId) || typeof scope.scriptEtag !== 'string' ||
      !/^[a-f0-9]{32}(?:[a-f0-9]{32})?$/.test(scope.scriptEtag) ||
      scope.scriptName !== SCRIPT) fail();
  return scope;
}

function activeDeployment(result, expectedVersion) {
  const active = result?.deployments?.[0];
  if (!object(active) || !uuid(active.id) || active.strategy !== 'percentage' ||
      !Array.isArray(active.versions) || active.versions.length !== 1 ||
      active.versions[0]?.version_id !== expectedVersion || active.versions[0]?.percentage !== 100) fail();
  return active.id;
}

function bindingsSnapshot(bindings, scope) {
  if (!Array.isArray(bindings) || bindings.length !== INERT_RUNTIME_FLAGS.length+1) fail();
  const seen = new Set(), normalized = [];
  for (const binding of bindings) {
    if (!object(binding) || seen.has(binding.name)) fail();
    seen.add(binding.name);
    if (binding.name === 'MARKET_SESSION') {
      if (binding.type !== 'durable_object_namespace' || binding.class_name !== 'MarketSession' ||
          binding.namespace_id !== scope.namespaceId ||
          binding.script_name !== undefined && binding.script_name !== SCRIPT ||
          binding.environment !== undefined) fail();
      normalized.push({name:binding.name,type:binding.type,class_name:binding.class_name,namespace_id:binding.namespace_id});
    } else {
      if (!INERT_RUNTIME_FLAGS.includes(binding.name) || binding.type !== 'plain_text' || binding.text !== 'false') fail();
      normalized.push({name:binding.name,type:binding.type,text:binding.text});
    }
  }
  return JSON.stringify(normalized.sort((a,b)=>a.name.localeCompare(b.name)));
}

function runtimeSnapshot(settings, scope) {
  if (!object(settings) || settings.compatibility_date !== '2026-07-30' ||
      !Array.isArray(settings.compatibility_flags) || settings.compatibility_flags.length !== 0 ||
      settings.migration_tag !== 'v1') fail();
  // API exports are optional; when present require the intended SQLite class only.
  if (settings.exports !== undefined) {
    if (!object(settings.exports) || Object.keys(settings.exports).some(key=>!['default','MarketSession'].includes(key)) ||
        settings.exports.MarketSession?.type !== 'durable-object' ||
        settings.exports.MarketSession?.storage !== 'sqlite' || settings.exports.MarketSession?.container !== undefined) fail();
  }
  return bindingsSnapshot(settings.bindings,scope);
}

async function getMetadata(path, apiToken, fetchImpl, timeoutMs) {
  const controller = new AbortController(); let timer;
  try {
    return await Promise.race([
      (async()=>{
        const response = await fetchImpl(ORIGIN+path, {method:'GET',redirect:'manual',cache:'no-store',signal:controller.signal,
          headers:{Authorization:`Bearer ${apiToken}`,Accept:'application/json'}});
        if (!response || response.status !== 200 || response.redirected ||
            !/^application\/json(?:\s*;|\s*$)/i.test(response.headers?.get('content-type') ?? '')) fail();
        const bytes = await readBoundedBody(response.body, 512_000, timeoutMs);
        const envelope = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        if (!object(envelope) || envelope.success !== true || !Array.isArray(envelope.errors) ||
            envelope.errors.length !== 0 || !Object.hasOwn(envelope,'result')) fail();
        return envelope;
      })(),
      new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('TIMEOUT'));},timeoutMs);}),
    ]);
  } catch {fail();}
  finally {clearTimeout(timer);controller.abort();}
}

/** Transport is injected; importing or planning this module makes no request. */
export async function inspectCloudflareIdentity({scope,apiToken,fetchImpl,timeoutMs=3000,nowMs=Date.now()}={}) {
  validateIdentityScope(scope);
  if (typeof apiToken !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(apiToken) ||
      typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs<10 || timeoutMs>10_000 ||
      !Number.isSafeInteger(nowMs) || nowMs<=0) fail();
  const base = `/accounts/${scope.accountId}/workers/scripts/${SCRIPT}`;
  let reads=0;
  const get=async path=>{const response=await getMetadata(path,apiToken,fetchImpl,timeoutMs);reads++;return response;};
  try {
    const deployment=(await get(base+'/deployments?per_page=1')).result;
    const deploymentId=activeDeployment(deployment,scope.versionId);
    const version=(await get(base+'/versions/'+scope.versionId)).result;
    if (version?.id!==scope.versionId || version.resources?.script?.etag!==scope.scriptEtag) fail();
    const versionBindings=runtimeSnapshot({...version.resources.script_runtime,bindings:version.resources.bindings},scope);
    const settings=(await get(base+'/settings')).result;
    const settingsBindings=runtimeSnapshot(settings,scope);
    if (versionBindings!==settingsBindings) fail();
    const namespaces=await get(`/accounts/${scope.accountId}/workers/durable_objects/namespaces?page=1&per_page=1000`);
    const info=namespaces.result_info;
    if (!Array.isArray(namespaces.result) || !object(info) || info.page!==1 || info.total_pages!==1 ||
        info.total_count!==namespaces.result.length || info.count!==namespaces.result.length) fail();
    const matches=namespaces.result.filter(n=>n?.id===scope.namespaceId);
    if (matches.length!==1 || matches[0].script!==SCRIPT || matches[0].class!=='MarketSession' || matches[0].use_sqlite!==true) fail();
    const subdomain=(await get(base+'/subdomain')).result;
    if (subdomain?.enabled!==false || subdomain.previews_enabled!==false) fail();
    const logging=(await get(base+'/script-settings')).result;
    if (logging?.logpush!==false || logging.observability?.enabled!==false ||
        !Array.isArray(logging.tail_consumers) || logging.tail_consumers.length!==0) fail();
    // Detect a concurrent version/binding change. This is still not an atomic snapshot.
    if (activeDeployment((await get(base+'/deployments?per_page=1')).result,scope.versionId)!==deploymentId ||
        runtimeSnapshot((await get(base+'/settings')).result,scope)!==settingsBindings) fail();
    return {format:'CLOUDFLARE_INERT_IDENTITY_V1',status:'METADATA_OBSERVED_NOT_DEPLOYMENT_ACCEPTED',
      checkedAtMs:nowMs,scriptName:SCRIPT,apiGetRequests:reads,
      identity:{accountFingerprint:await hash(scope.accountId),namespaceFingerprint:await hash(scope.namespaceId),
        versionFingerprint:await hash(scope.versionId),deploymentFingerprint:await hash(deploymentId),
        scriptEtagFingerprint:await hash(scope.scriptEtag)},
      observed:{singlePinnedVersion:true,sqliteNamespaceMatches:true,disabledRuntimeFlags:INERT_RUNTIME_FLAGS.length,
        unexpectedBindings:0,workersDevDisabled:true,previewUrlsDisabled:true,scriptLoggingDisabled:true},
      snapshotIsAtomic:false,freePlanVerified:false,noCardEligibilityVerified:false,sourceBundleVerified:false,
      deploymentAccepted:false,releaseAuthorized:false,realOrdersEnabled:false,
      unverified:['EXACT_REVIEWED_SOURCE_BUNDLE','ZONE_ROUTES_AND_CUSTOM_DOMAINS','ACCOUNT_IAM_AND_EXTERNAL_LOGS',
        'FREE_PLAN_NO_CARD_AND_NO_PAID_RESOURCES','EXISTING_DO_INSTANCES_ALARMS_AND_STORAGE',
        'DEPLOYMENT_AND_ROLLBACK_DRILL','FIVE_LIVE_ACCEPTANCE_GATES']};
  } catch {fail();}
}
