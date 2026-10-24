/** Offline-only Cloudflare Workers Free/SQLite Durable Object planning guard.
 * Numerical limits are a dated official-doc snapshot, NOT a billing guarantee.
 * No secret, cloud API, deploy command, HTTP request or account access here.
 */
import { sessionStatus } from './alarm-core.mjs';

export const FREE_REFERENCE_2026_10_24 = Object.freeze({
  sourceWorkers: 'https://developers.cloudflare.com/workers/platform/pricing/',
  sourceDurableObjects: 'https://developers.cloudflare.com/durable-objects/platform/pricing/',
  sourceLimits: 'https://developers.cloudflare.com/durable-objects/platform/limits/',
  workerRequestsPerDay: 100_000,
  workerCpuMsPerInvocation: 10,
  durableRequestsPerDay: 100_000,
  durableDurationGbSecondsPerDay: 13_000,
  durableRowsReadPerDay: 5_000_000,
  durableRowsWrittenPerDay: 100_000,
  durableStoredBytes: 5_000_000_000,
});

const SAFE_VARS = Object.freeze([
  'OFFLINE_SCHEDULER_ENABLED', 'READONLY_MARKET_RUNTIME_ENABLED',
  'OFFLINE_READONLY_REVIEW_ENABLED',
  'OFFLINE_PAPER_LEDGER_ENABLED', 'OFFLINE_SYNTHETIC_SESSION_ENABLED',
  'OFFLINE_DELIVERY_REHEARSAL_ENABLED', 'OFFLINE_PRIVATE_DASHBOARD_ENABLED',
]);
const sorted = values => [...values].sort().join(',');
const exactKeys = (object, keys) => object && !Array.isArray(object) &&
  typeof object === 'object' && sorted(Object.keys(object)) === sorted(keys);
const integer = (value, maximum = 10_000_000_000) =>
  Number.isSafeInteger(value) && value >= 0 && value <= maximum;

/** A release candidate needs separate owner approval; this only checks that
 * the committed example cannot turn on cloud execution when copied unchanged.
 */
export function validateDisabledCloudTemplate(config, packageManifest) {
  const allowed = ['name', 'main', 'compatibility_date', 'workers_dev',
    'preview_urls', 'vars', 'durable_objects', 'migrations', 'observability'];
  if (!exactKeys(config, allowed) || config.name !== 'nifty-paper-scheduler' ||
      config.main !== 'worker.mjs' || config.compatibility_date !== '2026-07-30' ||
      config.workers_dev !== false || config.preview_urls !== false ||
      !exactKeys(config.vars, SAFE_VARS) ||
      !SAFE_VARS.every(name => config.vars[name] === 'false') ||
      !exactKeys(config.durable_objects, ['bindings']) ||
      !Array.isArray(config.durable_objects.bindings) ||
      config.durable_objects.bindings.length !== 1 ||
      !exactKeys(config.durable_objects.bindings[0], ['name', 'class_name']) ||
      config.durable_objects.bindings[0].name !== 'MARKET_SESSION' ||
      config.durable_objects.bindings[0].class_name !== 'MarketSession' ||
      !Array.isArray(config.migrations) || config.migrations.length !== 1 ||
      !exactKeys(config.migrations[0], ['tag', 'new_sqlite_classes']) ||
      config.migrations[0].tag !== 'v1' ||
      JSON.stringify(config.migrations[0].new_sqlite_classes) !== '["MarketSession"]' ||
      !exactKeys(config.observability, ['enabled']) ||
      config.observability.enabled !== false) throw Error('UNSAFE_CLOUD_TEMPLATE');
  const scripts = packageManifest?.scripts;
  if (!scripts || Array.isArray(scripts) || typeof scripts !== 'object' ||
      Object.entries(scripts).some(([name, value]) =>
        /deploy|publish|upload|release/i.test(name) || typeof value !== 'string' ||
        /\bwrangler\s+(deploy|publish)\b/i.test(value)))
    throw Error('UNSAFE_DEPLOYMENT_SCRIPT');
  return Object.freeze({ status: 'SAFE_DISABLED_TEMPLATE_ONLY',
    ownerDeploymentApproved: false, cloudAccountConnected: false,
    runtimeFlagsEnabled: 0, publicRoutesEnabled: false });
}

/** Use conservative caller-supplied estimates. Unknown CPU or DO duration
 * prevents any release decision; passing quota arithmetic does not prove
 * correct billing, exchange data quality, wakeup latency or phone receipt.
 */
export function forecastFreeDailyUsage({ istDate, alarmsPerRegularDay = 1125,
  durableReadsPerAlarm = 6, durableWritesPerAlarm = 6,
  ownerDashboardRequests = 100, dashboardRowsReadPerRequest = 8,
  dailyHandoffRequests = 1, storedBytes = 4_000_000,
  observedWorkerCpuMsPerInvocation = null,
  observedDurableDurationGbSecondsPerDay = null } = {}) {
  const marketStatus = sessionStatus(istDate);
  if (marketStatus === null) throw Error('UNVERIFIED_EXCHANGE_YEAR');
  const counts = [alarmsPerRegularDay, durableReadsPerAlarm, durableWritesPerAlarm,
    ownerDashboardRequests, dashboardRowsReadPerRequest,
    dailyHandoffRequests, storedBytes];
  if (!counts.every(value => integer(value))) throw Error('INVALID_FORECAST_ASSUMPTION');
  if (observedWorkerCpuMsPerInvocation !== null &&
      (!Number.isFinite(observedWorkerCpuMsPerInvocation) ||
        observedWorkerCpuMsPerInvocation < 0)) throw Error('INVALID_CPU_OBSERVATION');
  if (observedDurableDurationGbSecondsPerDay !== null &&
      (!Number.isFinite(observedDurableDurationGbSecondsPerDay) ||
        observedDurableDurationGbSecondsPerDay < 0)) throw Error('INVALID_DURATION_OBSERVATION');
  // Unusual NSE sessions MUST NOT be converted into normal market slots.
  const alarms = marketStatus === 'REGULAR' ? alarmsPerRegularDay : 0;
  const expected = {
    workerRequestsPerDay: ownerDashboardRequests + dailyHandoffRequests,
    durableRequestsPerDay: alarms + ownerDashboardRequests + dailyHandoffRequests,
    durableRowsReadPerDay: alarms * durableReadsPerAlarm +
      ownerDashboardRequests * dashboardRowsReadPerRequest + dailyHandoffRequests,
    durableRowsWrittenPerDay: alarms * durableWritesPerAlarm + dailyHandoffRequests,
    durableStoredBytes: storedBytes,
  };
  if (!Object.values(expected).every(value => integer(value, Number.MAX_SAFE_INTEGER)))
    throw Error('FORECAST_OVERFLOW');
  const exceeded = Object.entries(expected).filter(([name, value]) =>
    value > FREE_REFERENCE_2026_10_24[name]).map(([name]) => name);
  if (observedWorkerCpuMsPerInvocation !== null &&
      observedWorkerCpuMsPerInvocation > FREE_REFERENCE_2026_10_24.workerCpuMsPerInvocation)
    exceeded.push('workerCpuMsPerInvocation');
  if (observedDurableDurationGbSecondsPerDay !== null &&
      observedDurableDurationGbSecondsPerDay >
        FREE_REFERENCE_2026_10_24.durableDurationGbSecondsPerDay)
    exceeded.push('durableDurationGbSecondsPerDay');
  return Object.freeze({ status: 'ESTIMATE_ONLY_NOT_DEPLOYMENT_APPROVAL',
    marketStatus, istDate, alarms, estimated: Object.freeze(expected),
    freeReference: FREE_REFERENCE_2026_10_24,
    measuredActualCloudUse: false,
    modeledLimitsExceeded: Object.freeze(exceeded),
    unresolved: Object.freeze([
      'OWNER_APPROVAL_MISSING', 'ACTUAL_CLOUD_QUOTAS_AND_LATENCY_UNMEASURED',
      'INDEPENDENT_PRIVATE_BACKUP_UNVERIFIED',
      ...(observedWorkerCpuMsPerInvocation === null ? ['WORKER_CPU_UNMEASURED'] : []),
      ...(observedDurableDurationGbSecondsPerDay === null ? ['DO_DURATION_UNMEASURED'] : []),
    ]),
    deploymentAuthorized: false, realOrdersEnabled: false,
  });
}
