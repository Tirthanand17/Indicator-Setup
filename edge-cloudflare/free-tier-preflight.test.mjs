import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateDisabledCloudTemplate, forecastFreeDailyUsage,
  FREE_REFERENCE_2026_10_24 } from './free-tier-preflight.mjs';

const example = async () => {
  const [raw, manifest] = await Promise.all([
    readFile(new URL('./wrangler.example.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('./package.json', import.meta.url), 'utf8'),
  ]);
  return { config: JSON.parse(raw.split('\n').filter(line =>
    !line.trimStart().startsWith('//')).join('\n')),
  packageManifest: JSON.parse(manifest) };
};

test('checked-in example is disabled, not a secretly enabled deploy template',async()=>{
  const { config, packageManifest } = await example();
  const review=validateDisabledCloudTemplate(config,packageManifest);
  assert.equal(review.status,'SAFE_DISABLED_TEMPLATE_ONLY');
  assert.equal(review.runtimeFlagsEnabled,0);
  assert.equal(review.ownerDeploymentApproved,false);
  assert.equal(review.publicRoutesEnabled,false);
});

test('unexpected deployment bindings, enabled feature, public route and scripts are rejected',async()=>{
  const { config, packageManifest } = await example();
  const mutate = fn => {
    const copy=structuredClone(config);
    fn(copy);
    return copy;
  };
  const unsafe=[
    mutate(c=>{c.workers_dev=true;}),
    mutate(c=>{c.preview_urls=true;}),
    mutate(c=>{c.vars.OFFLINE_SCHEDULER_ENABLED='true';}),
    mutate(c=>{c.vars.OFFLINE_OBSERVED_ARCHIVE_ENABLED='true';}),
    mutate(c=>{c.vars.OFFLINE_OBSERVED_RESTORE_ENABLED='true';}),
    mutate(c=>{c.vars.OFFLINE_DELIVERY_RECONCILIATION_ENABLED='true';}),
    mutate(c=>{c.vars.SCHEDULER_ADMIN_KEY='secret-accidentally-in-public-config';}),
    mutate(c=>{c.routes=['https://domain.invalid/*'];}),
    mutate(c=>{c.triggers={crons:['* * * * *']};}),
    mutate(c=>{c.r2_buckets=[{binding:'BACKUP',bucket_name:'public'}];}),
    mutate(c=>{c.durable_objects.bindings[0].name='OTHER';}),
    mutate(c=>{c.migrations[0].new_sqlite_classes=[];}),
    mutate(c=>{c.observability.enabled=true;}),
  ];
  for(const config of unsafe)
    assert.throws(()=>validateDisabledCloudTemplate(config,packageManifest),
      /UNSAFE_CLOUD_TEMPLATE/);
  assert.throws(()=>validateDisabledCloudTemplate(config,{
    scripts:{deploy:'wrangler deploy'}}),/UNSAFE_DEPLOYMENT_SCRIPT/);
  assert.throws(()=>validateDisabledCloudTemplate(config,{
    scripts:{test:'npx wrangler deploy'}}),/UNSAFE_DEPLOYMENT_SCRIPT/);
});

test('1125 regular slots are within selected arithmetic limits, not release approval',()=>{
  const report=forecastFreeDailyUsage({istDate:'2026-10-26'});
  assert.equal(report.alarms,1125);
  assert.equal(report.marketStatus,'REGULAR');
  assert.equal(report.estimated.durableRequestsPerDay,1226);
  assert.equal(report.estimated.durableRowsWrittenPerDay,22501);
  assert.equal(report.estimated.durableRowsReadPerDay,68301);
  assert.equal(report.marketTraffic.maximumQuoteRequests,1125);
  assert.equal(report.marketTraffic.maximumInstrumentsPerQuote,5);
  assert.equal(report.marketTraffic.cloudTimingVerified,false);
  assert.ok(report.unresolved.includes('SQL_ROW_AMPLIFICATION_UNMEASURED'));
  assert.deepEqual(report.modeledLimitsExceeded,[]);
  assert.equal(report.deploymentAuthorized,false);
  assert.equal(report.measuredActualCloudUse,false);
  assert.ok(report.unresolved.includes('WORKER_CPU_UNMEASURED'));
  assert.equal(FREE_REFERENCE_2026_10_24.durableStoredBytes,5_000_000_000);
});

test('quota overages, unknown 2027 year and official special day fail closed',()=>{
  const over=forecastFreeDailyUsage({istDate:'2026-10-26',
    durableWritesPerAlarm:90,storedBytes:5_000_000_001,
    observedWorkerCpuMsPerInvocation:12,
    observedDurableDurationGbSecondsPerDay:13_001});
  assert.ok(over.modeledLimitsExceeded.includes('durableRowsWrittenPerDay'));
  assert.ok(over.modeledLimitsExceeded.includes('durableStoredBytes'));
  assert.ok(over.modeledLimitsExceeded.includes('workerCpuMsPerInvocation'));
  assert.ok(over.modeledLimitsExceeded.includes('durableDurationGbSecondsPerDay'));
  assert.equal(forecastFreeDailyUsage({istDate:'2026-11-08'}).alarms,0);
  assert.equal(forecastFreeDailyUsage({istDate:'2026-11-10'}).alarms,0);
  assert.throws(()=>forecastFreeDailyUsage({istDate:'2027-01-04'}),
    /UNVERIFIED_EXCHANGE_YEAR/);
  assert.throws(()=>forecastFreeDailyUsage({istDate:'2026-10-26',
    durableWritesPerAlarm:NaN}),/INVALID_FORECAST_ASSUMPTION/);
});
