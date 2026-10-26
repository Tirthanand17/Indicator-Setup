/** Explicit operator client; defaults to help and never prints/decrypts to disk. */
import {createReadStream} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openObservedArchive,observedArchiveSummary,readObservedArchiveJSON} from './observed-archive.mjs';

const readArchive=file=>readObservedArchiveJSON(Readable.toWeb(createReadStream(file)));
const origin=value=>{
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('INVALID_ORIGIN');
  return u.origin;
};
const help='Observed paper archive: export <https-origin> <new-file.enc> | verify <file.enc> | restore <https-origin> <file.enc> --empty-quarantined. Keys: OBSERVED_ARCHIVE_HMAC_KEY, OBSERVED_ARCHIVE_AES_KEY; network commands also require SCHEDULER_ADMIN_KEY. Migration: migrate <https-origin> <verified-baseline.enc> --halted-source. Restore never resumes processing.';

export async function runObservedArchiveCLI(args,{env=process.env,fetchImpl=fetch,
  read=readArchive,write=writeFile,log=console.log,now=Date.now}={}) {
  if(args.length===0||args.length===1&&args[0]==='--help'){log(help);return 0;}
  const [command,first,second,confirmation]=args;
  if(!(command==='verify'&&args.length===2||command==='export'&&args.length===3||
    command==='restore'&&args.length===4&&confirmation==='--empty-quarantined'||command==='migrate'&&args.length===4&&confirmation==='--halted-source')){log('OBSERVED_ARCHIVE_BLOCKED_INVALID_ARGUMENTS');return 1;}
  try {
    const secrets={signingSecret:env.OBSERVED_ARCHIVE_HMAC_KEY,encryptionKeyBase64:env.OBSERVED_ARCHIVE_AES_KEY};
    const request=async(base,body,migrate=false)=>{
      const token=env.SCHEDULER_ADMIN_KEY;
      if(typeof token!=='string'||token.length<32||token.length>256||new Set(token).size<8||
        Object.values(secrets).includes(token))throw Error('INVALID_ADMIN_KEY');
      const response=await fetchImpl(origin(base)+(migrate?'/internal/observed-lifecycle':'/internal/observed-archive'+(body?'/restore':'')),{
        method:body?'POST':'GET',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(30000),
        headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{})});
      if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json'))throw Error('HTTP_FAILURE');
      return readObservedArchiveJSON(response.body);
    };
    if(command==='export') {
      const sealedArchive=await request(first),verified=await openObservedArchive({sealedArchive,...secrets});
      await write(second,JSON.stringify(sealedArchive)+'\n',{flag:'wx',mode:0o600});
      log(JSON.stringify({...observedArchiveSummary(verified),status:'EXPORTED_VERIFIED_ENCRYPTED_ARCHIVE'}));
    } else {
      const sealedArchive=await read(command==='verify'?first:second);
      const verified=await openObservedArchive({sealedArchive,...secrets});
      if(command==='verify')log(JSON.stringify(observedArchiveSummary(verified)));
      else {
        if(verified.createdAtMs>now())throw Error('RESTORE_CLOCK');
        const result=await request(first,sealedArchive,command==='migrate');
        if(command==='migrate') {
          if(!['LIFECYCLE_MIGRATED_HALTED','LIFECYCLE_ALREADY_MIGRATED'].includes(result.status)||result.baselineArchiveId!==verified.archiveId)throw Error('INVALID_MIGRATION_ACK');
          log(JSON.stringify({status:result.status,baselineArchiveId:result.baselineArchiveId}));return 0;
        }
        if(result.status!=='RESTORED_OBSERVED_PAPER_QUARANTINED'||result.archiveId!==verified.archiveId||result.automaticResume!==false)
          throw Error('INVALID_RESTORE_ACK');
        log(JSON.stringify({status:result.status,archiveId:result.archiveId,automaticResume:false}));
      }
    }
    return 0;
  } catch {log('OBSERVED_ARCHIVE_BLOCKED_SAFE_FAILURE');return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.exitCode=await runObservedArchiveCLI(process.argv.slice(2));
