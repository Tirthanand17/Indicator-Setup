/** Independent watchdog transitions and durable at-most-one notification claims. */
import {OPS_CODES} from './operational-health.mjs';
export const OPS_COOLDOWN_MS=300000;
export const MAX_OPS_STATE_BYTES=64000;
const fail=()=>{throw Error('INVALID_OPERATIONS_MONITOR_STATE');};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
export const newOperationsMonitor=targetHash=>({schema:1,targetHash,lastCheckAtMs:0,sequence:0,conditions:{},recent:[]});
export function auditOperationsMonitor(s) {
  if(!exact(s,['schema','targetHash','lastCheckAtMs','sequence','conditions','recent'])||s.schema!==1||typeof s.targetHash!=='string'||!/^[a-f0-9]{64}$/.test(s.targetHash)||
    !Number.isSafeInteger(s.lastCheckAtMs)||s.lastCheckAtMs<0||!Number.isSafeInteger(s.sequence)||s.sequence<0||
    !s.conditions||typeof s.conditions!=='object'||Array.isArray(s.conditions)||
    !Array.isArray(s.recent)||s.recent.length>128||JSON.stringify(s).length>MAX_OPS_STATE_BYTES)fail();
  for(const [code,v] of Object.entries(s.conditions))if(!Object.hasOwn(OPS_CODES,code)||!exact(v,['active','lastNotificationAtMs'])||typeof v.active!=='boolean'||
    !Number.isSafeInteger(v.lastNotificationAtMs)||v.lastNotificationAtMs<0||v.lastNotificationAtMs>s.lastCheckAtMs)fail();
  let prior=0;const latest=new Map();
  for(const e of s.recent) {
    if(!exact(e,['id','code','phase','atMs','delivery'])||!Number.isSafeInteger(e.id)||e.id<=prior||e.id>s.sequence||!Object.hasOwn(OPS_CODES,e.code)||
      !['OPEN','RESOLVED'].includes(e.phase)||!Number.isSafeInteger(e.atMs)||e.atMs<=0||e.atMs>s.lastCheckAtMs||
      !['NOT_REQUESTED','COOLDOWN','CLAIMED_UNCONFIRMED','API_ACCEPTED','DEFINITIVE_FAILURE_NO_RETRY','UNKNOWN_NO_RETRY'].includes(e.delivery))fail();
    if(!Object.hasOwn(s.conditions,e.code))fail();
    if(['CLAIMED_UNCONFIRMED','API_ACCEPTED','DEFINITIVE_FAILURE_NO_RETRY','UNKNOWN_NO_RETRY'].includes(e.delivery)&&
      s.conditions[e.code].lastNotificationAtMs<e.atMs)fail();
    latest.set(e.code,e.phase);
    prior=e.id;
  }
  if(s.recent.length!==Math.min(s.sequence,128)||s.sequence>0&&s.recent.at(-1).id!==s.sequence)fail();
  if(Object.keys(s.conditions).length>s.sequence)fail();
  for(const [code,phase] of latest)if(s.conditions[code].active!==(phase==='OPEN'))fail();
  return true;
}
export function validateOperationsResponse(value,nowMs) {
  if(!value||value.format!=='OBSERVED_OPERATIONS_V1'||!Number.isSafeInteger(value.checkedAtMs)||value.checkedAtMs<=0||
    Math.abs(value.checkedAtMs-nowMs)>30000||!Array.isArray(value.issues)||value.issues.length>Object.keys(OPS_CODES).length)throw Error('INVALID_OPERATIONS_RESPONSE');
  const seen=new Set();
  for(const i of value.issues) {
    if(!i||!Object.hasOwn(OPS_CODES,i.code)||i.code==='ENDPOINT_UNAVAILABLE'||i.severity!==OPS_CODES[i.code]||seen.has(i.code))throw Error('INVALID_OPERATIONS_RESPONSE');
    seen.add(i.code);
  }
  return [...seen];
}
export async function runOperationsCycle(state,{nowMs,probe,persist,notify,notifications=false}={}) {
  auditOperationsMonitor(state);
  if(!Number.isSafeInteger(nowMs)||nowMs<=0||nowMs<state.lastCheckAtMs)fail();
  let active;
  try {active=validateOperationsResponse(await probe(),nowMs);}
  catch {active=[...Object.entries(state.conditions).filter(([,v])=>v.active).map(([k])=>k),'ENDPOINT_UNAVAILABLE'];}
  const set=new Set(active),next=structuredClone(state),events=[];
  next.lastCheckAtMs=nowMs;
  for(const code of Object.keys(OPS_CODES)) {
    const old=next.conditions[code],isActive=set.has(code);
    if(!old&&!isActive)continue;
    if(!old||old.active!==isActive) {
      const event={id:++next.sequence,code,phase:isActive?'OPEN':'RESOLVED',atMs:nowMs,delivery:'NOT_REQUESTED'};
      next.recent.push(event);events.push(event);
    }
    next.conditions[code]={active:isActive,lastNotificationAtMs:old?.lastNotificationAtMs??0};
  }
  next.recent=next.recent.slice(-128);await persist(next);
  const claimed=[];
  for(const e of events)if(notifications) {
    const c=next.conditions[e.code];
    if(c.lastNotificationAtMs&&nowMs-c.lastNotificationAtMs<OPS_COOLDOWN_MS){e.delivery='COOLDOWN';continue;}
    e.delivery='CLAIMED_UNCONFIRMED';c.lastNotificationAtMs=nowMs;claimed.push(e);
  }
  if(notifications&&events.length)await persist(next);
  if(claimed.length) {
    let response;
    try {response=await notify({message:`PAPER OPERATIONS\n${claimed.map(e=>e.phase+' '+e.code).join('\n')}\n${new Date(nowMs).toISOString()}\nOperational conditions only; no trade or phone-receipt verification.`});}
    catch {response=null;}
    const verdict=response?.httpStatus===200&&response.botResponse?.ok===true&&
      Number.isSafeInteger(response.botResponse?.result?.message_id)&&response.botResponse.result.message_id>0?'API_ACCEPTED':
      [400,401,403,404,429].includes(response?.httpStatus)?'DEFINITIVE_FAILURE_NO_RETRY':'UNKNOWN_NO_RETRY';
    for(const e of claimed)e.delivery=verdict;
    await persist(next);
  }
  return {state:next,events:structuredClone(events),endpointAvailable:!set.has('ENDPOINT_UNAVAILABLE'),phoneDeliveredVerified:false};
}
