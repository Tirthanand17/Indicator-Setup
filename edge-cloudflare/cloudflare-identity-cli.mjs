/** No HTTP by default. Credentials come from the environment and are never printed. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectCloudflareIdentity} from './cloudflare-identity-readonly.mjs';

export async function runIdentityCLI(args,{env=process.env,fetchImpl=globalThis.fetch,log=console.log}={}) {
  if (args.length===0 || args.length===1 && args[0]==='--help') {
    log('CLOUDFLARE_IDENTITY_NOT_RUN: No HTTP, upload, deployment or account change.');
    log('For authorized GET-only inspection use --run with CLOUDFLARE_IDENTITY_READ_APPROVED=yes, CLOUDFLARE_IDENTITY_ACCOUNT_ID, CLOUDFLARE_IDENTITY_READ_TOKEN, CLOUDFLARE_IDENTITY_NAMESPACE_ID, CLOUDFLARE_IDENTITY_VERSION_ID and CLOUDFLARE_IDENTITY_SCRIPT_ETAG.');
    return 0;
  }
  if (args.length!==1 || args[0]!=='--run' || env.CLOUDFLARE_IDENTITY_READ_APPROVED!=='yes') {
    log('CLOUDFLARE_IDENTITY_BLOCKED_NOT_APPROVED');return 1;
  }
  try {
    const report=await inspectCloudflareIdentity({scope:{scriptName:'nifty-paper-scheduler',
      accountId:env.CLOUDFLARE_IDENTITY_ACCOUNT_ID,namespaceId:env.CLOUDFLARE_IDENTITY_NAMESPACE_ID,
      versionId:env.CLOUDFLARE_IDENTITY_VERSION_ID,scriptEtag:env.CLOUDFLARE_IDENTITY_SCRIPT_ETAG},
      apiToken:env.CLOUDFLARE_IDENTITY_READ_TOKEN,fetchImpl});
    log(JSON.stringify(report));return 2; // Observation is never deployment acceptance.
  } catch {log('CLOUDFLARE_IDENTITY_BLOCKED_SAFE_FAILURE');return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.exitCode=await runIdentityCLI(process.argv.slice(2));
