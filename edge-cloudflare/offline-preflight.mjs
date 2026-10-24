/** Read-only local source check. Prints aggregate numbers only; never deploys. */
import { readFile } from 'node:fs/promises';
import { validateDisabledCloudTemplate, forecastFreeDailyUsage } from './free-tier-preflight.mjs';

try {
  const [raw, manifest] = await Promise.all([
    readFile(new URL('./wrangler.example.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('./package.json', import.meta.url), 'utf8'),
  ]);
  const config=JSON.parse(raw.split('\n').filter(line=>
    !line.trimStart().startsWith('//')).join('\n'));
  const safe=validateDisabledCloudTemplate(config,JSON.parse(manifest));
  const forecast=forecastFreeDailyUsage({istDate:'2026-10-26'});
  console.log(JSON.stringify({mode:'OFFLINE_NO_CLOUD_ACTION',
    template:safe,forecast},null,2));
  if(forecast.modeledLimitsExceeded.length)process.exitCode=1;
} catch {
  // Errors are intentionally sanitized: never dump configs or environment.
  console.error('BLOCKED_OFFLINE_PREFLIGHT_INVALID_TEMPLATE_OR_ASSUMPTIONS');
  process.exitCode=1;
}
