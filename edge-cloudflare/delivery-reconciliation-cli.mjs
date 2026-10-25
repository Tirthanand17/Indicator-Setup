/** Explicit owner client; no request by default, no send or resume operation. */
import {createReadStream} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readReconciliationJSON,validateReconciliationRequest} from './delivery-reconciliation.mjs';

const HELP='Delivery reconciliation: inspect <https-origin> <new-inspection.json> | suppress <https-origin> <inspection.json> --acknowledge-unknown-delivery. Requires SCHEDULER_ADMIN_KEY in the environment. Source must be halted. Suppression never resends, verifies delivery or resumes processing.';
export async function runDeliveryReconciliationCLI(args,{env=process.env,fetchImpl=fetch,
  read=file=>readReconciliationJSON(Readable.toWeb(createReadStream(file))),write=writeFile,log=console.log}={}) {
  if(!args.length||args.length===1&&args[0]==='--help'){log(HELP);return 0;}
  const [command,origin,file,ack]=args;
  if(!(command==='inspect'&&args.length===3||command==='suppress'&&args.length===4&&ack==='--acknowledge-unknown-delivery'))
    {log('RECONCILIATION_BLOCKED_INVALID_ARGUMENTS');return 1;}
  try {
    const url=new URL(origin),key=env.SCHEDULER_ADMIN_KEY;
    if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||
      typeof key!=='string'||key.length<32||key.length>256||new Set(key).size<8)throw Error('INVALID_CONFIGURATION');
    let input;
    if(command==='suppress') {
      const inspection=await read(file);
      if(inspection.format!=='OBSERVED_DELIVERY_RECONCILIATION_V1'||inspection.canSuppress!==true||
        inspection.status!=='OWNER_DECISION_REQUIRED')throw Error('INELIGIBLE_INSPECTION');
      input=inspection.request;validateReconciliationRequest(input);
    }
    const response=await fetchImpl(url.origin+'/internal/readonly-delivery/reconcile',{
      method:input?'POST':'GET',credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(15000),
      headers:{authorization:'Bearer '+key,...(input?{'content-type':'application/json'}:{})},
      ...(input?{body:JSON.stringify(input)}:{})});
    if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json'))throw Error('HTTP_REJECTED');
    const result=await readReconciliationJSON(response.body);
    if(command==='inspect') {
      if(result.format!=='OBSERVED_DELIVERY_RECONCILIATION_V1'||typeof result.canSuppress!=='boolean')throw Error('INVALID_RESPONSE');
      if(result.request!==null)validateReconciliationRequest(result.request);
      await write(file,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
      log(JSON.stringify({status:result.status,canSuppress:result.canSuppress,blockedBy:result.blockedBy,
        deliveryAttempted:false,schedulerResumed:false}));
    } else {
      if(!['SUPPRESSED_UNCERTAIN','ALREADY_TERMINAL_NO_ACTION'].includes(result.status)||result.eventId!==input.eventId||
        result.deliveryAttempted!==false||result.schedulerResumed!==false||result.phoneDeliveredVerified!==false)
        throw Error('INVALID_ACKNOWLEDGEMENT');
      log(JSON.stringify({status:result.status,terminalStatus:result.terminalStatus,deliveryAttempted:false,
        schedulerResumed:false,phoneDeliveredVerified:false}));
    }
    return 0;
  } catch {log('RECONCILIATION_BLOCKED_SAFE_FAILURE');return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.exitCode=await runDeliveryReconciliationCLI(process.argv.slice(2));
