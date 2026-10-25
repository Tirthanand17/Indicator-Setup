/** Private external-watchdog state; never a copy of credentials or paper data. */
import {open,rename,mkdir,rmdir,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {auditOperationsMonitor,newOperationsMonitor,MAX_OPS_STATE_BYTES} from './operations-watchdog.mjs';

export async function withOperationsStore(file,targetHash,operation) {
  const absolute=path.resolve(file),lock=absolute+'.lock';
  await mkdir(lock,{mode:0o700}); // Never steal an existing/crashed writer's lock.
  try {
    let state;
    try {
      const handle=await open(absolute,'r');
      try {
        if((await handle.stat()).size>MAX_OPS_STATE_BYTES)throw Error('MONITOR_STATE_TOO_LARGE');
        const buffer=Buffer.alloc(MAX_OPS_STATE_BYTES+1);let size=0;
        while(size<buffer.length){const {bytesRead}=await handle.read(buffer,size,buffer.length-size,null);if(!bytesRead)break;size+=bytesRead;}
        if(size>MAX_OPS_STATE_BYTES)throw Error('MONITOR_STATE_TOO_LARGE');
        state=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size)));
      }finally{await handle.close();}
    }catch(error){if(error.code!=='ENOENT')throw error;state=newOperationsMonitor(targetHash);}
    auditOperationsMonitor(state);if(state.targetHash!==targetHash)throw Error('MONITOR_TARGET_MISMATCH');
    const persist=async next=>{
      auditOperationsMonitor(next);if(next.targetHash!==targetHash)throw Error('MONITOR_TARGET_MISMATCH');
      const temp=absolute+'.'+randomUUID()+'.tmp';let created=false;
      try {
        const h=await open(temp,'wx',0o600);created=true;
        try{await h.writeFile(JSON.stringify(next)+'\n');await h.sync();}finally{await h.close();}
        await rename(temp,absolute);created=false;
      }finally{if(created)await unlink(temp).catch(()=>{});}
      state=structuredClone(next);
    };
    return await operation({state,persist});
  }finally{await rmdir(lock);}
}
