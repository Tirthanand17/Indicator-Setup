/** Explicit, externally run monitor. No process or remote service is installed. */
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runOperationsCycle} from './operations-watchdog.mjs';
import {withOperationsStore} from './operations-monitor-store.mjs';
import {sendTelegramPaperMessage,validPrivateTelegramConfig} from './telegram-sender.mjs';
import {OPS_CODES} from './operational-health.mjs';

const HELP='Operations monitor: check <https-origin> <private-state.ops-monitor.json> [--notify] | watch <https-origin> <private-state.ops-monitor.json> [--notify]. Uses OPS_HEALTH_VIEW_KEY. Notifications additionally require --notify, OPS_ALERT_NOTIFICATIONS_ENABLED=true and separate OPS_TELEGRAM_BOT_TOKEN/OPS_TELEGRAM_PRIVATE_CHAT_ID. No requests by default.';
async function boundedJSON(response) {
  if(!response?.ok||!response.headers.get('content-type')?.startsWith('application/json')||!response.body)throw Error('UNAVAILABLE');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>16384){await reader.cancel();throw Error('TOO_LARGE');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const joined=new Uint8Array(size);let at=0;for(const c of chunks){joined.set(c,at);at+=c.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));
}
export async function runOperationsCLI(args,{env=process.env,fetchImpl=fetch,store=withOperationsStore,
  now=Date.now,log=console.log,wait=delay,signal,send=sendTelegramPaperMessage}={}) {
  if(!args.length||args.length===1&&args[0]==='--help'){log(HELP);return 0;}
  const [mode,origin,file,option]=args;
  if(!['check','watch'].includes(mode)||![3,4].includes(args.length)||args.length===4&&option!=='--notify')
    {log('OPERATIONS_MONITOR_INVALID_ARGUMENTS');return 1;}
  try {
    const u=new URL(origin),key=env.OPS_HEALTH_VIEW_KEY,notifications=option==='--notify';
    if(u.protocol!=='https:'||u.pathname!=='/'||u.username||u.password||u.search||u.hash||
      typeof key!=='string'||key.length<32||key.length>256||new Set(key).size<8)throw Error('INVALID_CONFIGURATION');
    const token=env.OPS_TELEGRAM_BOT_TOKEN,chatId=env.OPS_TELEGRAM_PRIVATE_CHAT_ID;
    if(notifications&&(env.OPS_ALERT_NOTIFICATIONS_ENABLED!=='true'||
      !validPrivateTelegramConfig({token,chatId})||token===env.TELEGRAM_BOT_TOKEN||key===token||key===env.SCHEDULER_ADMIN_KEY))
      throw Error('NOTIFICATION_CONFIGURATION_REQUIRED');
    const targetHash=createHash('sha256').update(u.origin).digest('hex');
    return await store(file,targetHash,async storage=>{
      let state=storage.state,available,exitCode;
      do {
        const result=await runOperationsCycle(state,{nowMs:now(),persist:storage.persist,notifications,
          probe:async()=>boundedJSON(await fetchImpl(u.origin+'/internal/operations',{
            method:'GET',redirect:'manual',credentials:'omit',headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)})),
          notify:({message})=>send({token,chatId,message,fetchImpl})});
        state=result.state;available=result.endpointAvailable;
        exitCode=Object.entries(state.conditions).some(([code,v])=>v.active&&OPS_CODES[code]==='CRITICAL')?2:0;
        log(JSON.stringify({status:'OPERATIONS_CHECK_COMPLETE',endpointAvailable:available,
          transitions:result.events.map(e=>({code:e.code,phase:e.phase,delivery:e.delivery})),
          activeConditions:Object.entries(state.conditions).filter(([,v])=>v.active).map(([code])=>code),phoneDeliveredVerified:false}));
        if(mode==='check'||signal?.aborted)break;
        try{await wait(60000,undefined,{signal});}catch(error){if(signal?.aborted)break;throw error;}
      }while(!signal?.aborted);
      return exitCode;
    });
  }catch{log('OPERATIONS_MONITOR_BLOCKED_SAFE_FAILURE');return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const controller=new AbortController();
  for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>controller.abort());
  process.exitCode=await runOperationsCLI(process.argv.slice(2),{signal:controller.signal});
}
