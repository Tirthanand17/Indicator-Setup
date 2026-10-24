import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dayWindow } from './cloudflare-metrics-cli.mjs';

const cli=fileURLToPath(new URL('./cloudflare-metrics-cli.mjs',import.meta.url));

test('UTC day window has an exact single-day boundary',()=>{
  const result=dayWindow('2026-10-23');
  assert.deepEqual(result,{datetimeStart:'2026-10-23T00:00:00.000Z',
    datetimeEnd:'2026-10-24T00:00:00.000Z'});
  for(const bad of ['not-a-date','2026-02-30','2027-01-01','2026-10-24T00:00'])
    assert.throws(()=>dayWindow(bad),/INVALID_UTC_DAY/);
});

test('CLI without explicit --run is a zero-network help-only operation',()=>{
  const run=spawnSync(process.execPath,[cli],{encoding:'utf8',timeout:5000,
    env:{...process.env,CLOUDFLARE_ANALYTICS_READ_TOKEN:'SENSITIVE_FIXTURE'}});
  assert.equal(run.status,0);
  assert.match(run.stdout,/CLOUDFLARE_METRICS_NOT_RUN/);
  assert.doesNotMatch(run.stdout,/SENSITIVE_FIXTURE/);
  assert.doesNotMatch(run.stderr,/SENSITIVE_FIXTURE/);
});

test('even --run is blocked unless analytics read approval is explicit',()=>{
  const run=spawnSync(process.execPath,[cli,'--run'],{encoding:'utf8',timeout:5000,
    env:{...process.env,CLOUDFLARE_METRICS_READ_APPROVED:'no',
      CLOUDFLARE_ANALYTICS_READ_TOKEN:'SENSITIVE_FIXTURE'}});
  assert.equal(run.status,1);
  assert.match(run.stderr,/CLOUDFLARE_METRICS_BLOCKED_NOT_APPROVED/);
  assert.doesNotMatch(run.stderr,/SENSITIVE_FIXTURE/);
});
