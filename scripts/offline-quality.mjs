import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('..',import.meta.url));
const edge=path.join(root,'edge-cloudflare');

/** Never pass inherited broker, bot, cloud or arbitrary application secrets. */
export function qualityEnvironment(source) {
  const keep=new Set(['path','systemroot','windir','comspec','pathext','temp','tmp',
    'home','userprofile','localappdata','appdata','lang','lc_all','tz','ci']);
  const env=Object.fromEntries(Object.entries(source).filter(([key])=>keep.has(key.toLowerCase())));
  for(const key of ['ALERTS_ENABLED','PAPER_AUTOTRADE_ENABLED','PAPER_DASHBOARD_ENABLED',
    'PAPER_PREMIUM_TRACKING_ENABLED','KITE_SHADOW_ENABLED','OFFLINE_SCHEDULER_ENABLED',
    'READONLY_MARKET_RUNTIME_ENABLED','OFFLINE_READONLY_REVIEW_ENABLED',
    'OFFLINE_OPTION_SNAPSHOT_ENABLED','OFFLINE_PAPER_BRIDGE_ENABLED',
    'OFFLINE_READONLY_DELIVERY_REHEARSAL_ENABLED','OFFLINE_TELEGRAM_SENDER_ENABLED',
    'OFFLINE_PAPER_LEDGER_ENABLED','OFFLINE_SYNTHETIC_SESSION_ENABLED',
    'OFFLINE_DELIVERY_REHEARSAL_ENABLED','OFFLINE_PRIVATE_DASHBOARD_ENABLED',
    'OFFLINE_OBSERVED_ARCHIVE_ENABLED','OFFLINE_OBSERVED_RESTORE_ENABLED']) env[key]='false';
  return env;
}

export function runQuality(args,{source=process.env,run=spawnSync,log=console.log}={}) {
  if(args.length!==1||!['--js','--python','--all'].includes(args[0])) {
    log('Usage: offline-quality.mjs --js | --python | --all');return 2;
  }
  const env=qualityEnvironment(source);
  const node=process.execPath;
  const python=source.QUALITY_PYTHON??(process.platform==='win32'?'python':'python3');
  const checks=[];
  if(args[0]!=='--python') checks.push(
    ['JavaScript lint',node,[path.join(edge,'node_modules/eslint/bin/eslint.js'),
      '--config',path.join(root,'eslint.config.mjs'),'eslint.config.mjs','edge-cloudflare','extension','scripts','--max-warnings=0']],
    ['JavaScript tests',node,['--test','edge-cloudflare/*.test.mjs','extension/tests/*.test.cjs','scripts/*.test.mjs']],
    ['Disabled template preflight',node,['edge-cloudflare/offline-preflight.mjs']],
    ['Native SQLite tests',node,['--test','edge-cloudflare/runtime/*.test.mjs']]);
  if(args[0]!=='--js') checks.push(
    ['Python lint',python,['-m','ruff','check','cloud-alerts','edge-cloudflare','--config','ruff.toml']],
    ['Python types',python,['-m','mypy','--config-file','cloud-alerts/mypy.ini','cloud-alerts/cloud_alerts']],
    ['Python tests',python,['-m','pytest','-q','cloud-alerts/tests']],
    ['Python dependency advisories',python,['-m','pip_audit','-r','cloud-alerts/requirements-quality.txt','--progress-spinner','off']]);
  for(const [label,command,commandArgs] of checks) {
    log(`QUALITY: ${label}`);
    const result=run(command,commandArgs,{cwd:root,env,stdio:'inherit',shell:false,timeout:600_000});
    if(result.error||result.signal||result.status!==0) {
      log(`FAILED: ${label}`);return Number.isInteger(result.status)&&result.status>0?result.status:1;
    }
  }
  log('QUALITY: selected checks passed (offline execution evidence only)');return 0;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.exitCode=runQuality(process.argv.slice(2));
