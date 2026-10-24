/** An explicit, read-only Cloudflare account analytics probe. Nothing is
 * executed by default; never use a trading/broker credential for this API.
 * Token is taken only from a process environment variable, never printed.
 */
import { probeCloudflareReadOnlyMetrics } from './cloudflare-metrics-readonly.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const usage=()=>{
  console.log('CLOUDFLARE_METRICS_NOT_RUN: This command makes no request by default.');
  console.log('For a separately approved Analytics Read query, set CLOUDFLARE_ANALYTICS_ACCOUNT_TAG, CLOUDFLARE_ANALYTICS_READ_TOKEN, CLOUDFLARE_METRICS_UTC_DAY (YYYY-MM-DD), CLOUDFLARE_METRICS_READ_APPROVED=yes, then run npm run metrics:probe -- --run.');
  console.log('No token, account ID or raw API response will be printed. No Worker is deployed.');
};

export const dayWindow=day=>{
  if(typeof day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(day))
    throw Error('INVALID_UTC_DAY');
  const midnight=Date.parse(`${day}T00:00:00.000Z`);
  if(!Number.isSafeInteger(midnight)||
      new Date(midnight).toISOString().slice(0,10)!==day||
      midnight+24*3600_000>Date.now()) throw Error('INVALID_UTC_DAY');
  return {datetimeStart:new Date(midnight).toISOString(),
    datetimeEnd:new Date(midnight+24*3600_000).toISOString()};
};

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length===2||process.argv[2]==='--help') usage();
  else if(process.argv.length!==3||process.argv[2]!=='--run'||
      process.env.CLOUDFLARE_METRICS_READ_APPROVED!=='yes'){
    console.error('CLOUDFLARE_METRICS_BLOCKED_NOT_APPROVED');
    process.exitCode=1;
  }else{
    try{
      const report=await probeCloudflareReadOnlyMetrics({
        accountTag:process.env.CLOUDFLARE_ANALYTICS_ACCOUNT_TAG,
        apiToken:process.env.CLOUDFLARE_ANALYTICS_READ_TOKEN,
        ...dayWindow(process.env.CLOUDFLARE_METRICS_UTC_DAY),fetchImpl:fetch});
      console.log('CLOUDFLARE_READONLY_METRICS '+JSON.stringify(report));
      if(report.status!=='READONLY_METRICS_OBSERVED_NOT_ACCEPTED')
        process.exitCode=2;
    }catch{
      console.error('CLOUDFLARE_METRICS_BLOCKED_SAFE_FAILURE');
      process.exitCode=1;
    }
  }
}
