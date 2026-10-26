/** Explicit owner paper write-off client, never a source of price/fill evidence. */
import {createReadStream} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readObservedArchiveJSON,openObservedArchive} from './observed-archive.mjs';
import {validatePositionRequest} from './position-reconciliation.mjs';
const read=file=>readObservedArchiveJSON(Readable.toWeb(createReadStream(file)));
const HELP='Position reconciliation: inspect <https-origin> <new-inspection.reconciliation.json> | writeoff <https-origin> <inspection.reconciliation.json> <verified-baseline.enc> --acknowledge-unknown-exit-zero-credit. Uses SCHEDULER_ADMIN_KEY and archive keys from environment. No refund, fill or resume. No request by default.';
export async function runPositionReconciliationCLI(args,{env=process.env,fetchImpl=fetch,readFile=read,
  write=writeFile,log=console.log}={}) {
  if(!args.length||args.length===1&&args[0]==='--help'){log(HELP);return 0;}
  const [mode,origin,file,archiveFile,ack]=args;
  if(!(mode==='inspect'&&args.length===3||mode==='writeoff'&&args.length===5&&ack==='--acknowledge-unknown-exit-zero-credit'))
    {log('POSITION_RECONCILIATION_INVALID_ARGUMENTS');return 1;}
  try {
    const u=new URL(origin),key=env.SCHEDULER_ADMIN_KEY;
    if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password||
      typeof key!=='string'||key.length<32||key.length>256||new Set(key).size<8)throw Error('INVALID_CONFIGURATION');
    let body,archiveId;
    if(mode==='writeoff') {
      const inspection=await readFile(file);
      if(inspection.format!=='OBSERVED_POSITION_RECONCILIATION_V1'||inspection.canWriteOff!==true)throw Error('INELIGIBLE_INSPECTION');
      validatePositionRequest(inspection.request);
      const sealedArchive=await readFile(archiveFile);
      const verified=await openObservedArchive({sealedArchive,signingSecret:env.OBSERVED_ARCHIVE_HMAC_KEY,encryptionKeyBase64:env.OBSERVED_ARCHIVE_AES_KEY});
      if(inspection.request.ledgerMutationAtMs!==verified.state.ledger.lastMutationAtMs)throw Error('BASELINE_PROOF_MISMATCH');
      body={request:inspection.request,sealedArchive};archiveId=verified.archiveId;
    }
    const response=await fetchImpl(u.origin+'/internal/readonly-paper/reconcile',{method:body?'POST':'GET',
      headers:{authorization:'Bearer '+key,...(body?{'content-type':'application/json'}:{})},
      redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(30000),...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json'))throw Error('REJECTED');
    const result=await readObservedArchiveJSON(response.body);
    if(mode==='inspect') {
      if(result.format!=='OBSERVED_POSITION_RECONCILIATION_V1'||typeof result.canWriteOff!=='boolean')throw Error('INVALID_RESPONSE');
      if(result.request!==null)validatePositionRequest(result.request);
      await write(file,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
      log(JSON.stringify({status:result.status,canWriteOff:result.canWriteOff,blockedBy:result.blockedBy}));
    }else {
      if(!['POSITIONS_WRITTEN_OFF_UNKNOWN_EXIT','POSITIONS_ALREADY_RECONCILED_NO_ACTION'].includes(result.status)||
        result.baselineArchiveId!==archiveId||result.cashCreditPaise!==0||result.strategyExitFillKnown!==false||result.schedulerResumed!==false)
        throw Error('INVALID_ACKNOWLEDGEMENT');
      log(JSON.stringify({status:result.status,cashCreditPaise:0,strategyExitFillKnown:false,schedulerResumed:false}));
    }
    return 0;
  }catch{log('POSITION_RECONCILIATION_BLOCKED_SAFE_FAILURE');return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.exitCode=await runPositionReconciliationCLI(process.argv.slice(2));
