import test from 'node:test';
import assert from 'node:assert/strict';
import {qualityEnvironment,runQuality} from './offline-quality.mjs';

test('quality subprocesses cannot inherit application credentials or enabled flags',()=>{
  const source={PATH:'/synthetic/bin',HOME:'/synthetic/home',SystemRoot:'synthetic-windows',
    KITE_API_KEY:'synthetic-secret',TELEGRAM_BOT_TOKEN:'synthetic-secret',
    CLOUDFLARE_API_TOKEN:'synthetic-secret',PYTHONPATH:'/untrusted/imports',
    NODE_OPTIONS:'--require=/untrusted/script',ALERTS_ENABLED:'true',OFFLINE_TELEGRAM_SENDER_ENABLED:'true',
    OBSERVED_ARCHIVE_HMAC_KEY:'synthetic-secret',OBSERVED_ARCHIVE_AES_KEY:'synthetic-secret',
    OFFLINE_OBSERVED_ARCHIVE_ENABLED:'true',OFFLINE_OBSERVED_RESTORE_ENABLED:'true',OFFLINE_DELIVERY_RECONCILIATION_ENABLED:'true',
    OFFLINE_OPERATIONAL_HEALTH_ENABLED:'true',OPS_ALERT_NOTIFICATIONS_ENABLED:'true',OPS_HEALTH_VIEW_KEY:'synthetic-secret'};
  const env=qualityEnvironment(source);
  assert.equal(env.PATH,source.PATH);assert.equal(env.SystemRoot,source.SystemRoot);
  assert.equal(JSON.stringify(env).includes('synthetic-secret'),false);
  assert.equal(env.PYTHONPATH,undefined);assert.equal(env.NODE_OPTIONS,undefined);
  assert.equal(env.ALERTS_ENABLED,'false');assert.equal(env.OFFLINE_TELEGRAM_SENDER_ENABLED,'false');
  assert.equal(env.OFFLINE_OBSERVED_ARCHIVE_ENABLED,'false');assert.equal(env.OFFLINE_OBSERVED_RESTORE_ENABLED,'false');
  assert.equal(env.OFFLINE_DELIVERY_RECONCILIATION_ENABLED,'false');
  assert.equal(env.OFFLINE_OPERATIONAL_HEALTH_ENABLED,'false');assert.equal(env.OPS_ALERT_NOTIFICATIONS_ENABLED,'false');
});

test('quality gate stops at the first failure and preserves its exit status',()=>{
  let calls=0;
  const result=runQuality(['--all'],{source:{},log:()=>{},run:(_cmd,_args,options)=>{
    calls++;assert.equal(options.shell,false);return {status:7};
  }});
  assert.equal(result,7);assert.equal(calls,1);
  assert.equal(runQuality(['--all','--deploy'],{log:()=>{}}),2);
});

test('spawn failure or signal never becomes a passing quality result',()=>{
  for(const result of [{error:Error('synthetic spawn fault')},{status:null,signal:'SIGTERM'}])
    assert.equal(runQuality(['--js'],{source:{},log:()=>{},run:()=>result}),1);
});
