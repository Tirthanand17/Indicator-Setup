import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NSE_FO_CALENDAR} from '../edge-cloudflare/calendar-data.mjs';
import {calendarSessionStatus, calendarMaintenanceStatus, validateCalendar} from '../edge-cloudflare/calendar-schema.mjs';
import {sessionStatus, assessAlarm, validClaimedTickId} from '../edge-cloudflare/alarm-core.mjs';
import {calendarArtifacts, runCalendarMaintenance} from './calendar-maintenance.mjs';

const canonical = new URL('../cloud-alerts/cloud_alerts/data/nse-fo-calendar.json', import.meta.url);
const clone = () => structuredClone(NSE_FO_CALENDAR);
const quiet = () => {};
test('generated artifacts match the reviewed bytes and cannot be mutated at runtime', () => {
  assert.equal(runCalendarMaintenance(['--check'], quiet), 0);
  assert.deepEqual(calendarArtifacts(readFileSync(canonical)).calendar, NSE_FO_CALENDAR);
  assert.throws(() => NSE_FO_CALENDAR.years[0].holidays.push('2026-12-31'), TypeError);
});
test('every covered day uses canonical data, including amendments and weekend exceptions', () => {
  for (const year of NSE_FO_CALENDAR.years) {
  for (let ms = Date.parse(`${year.year}-01-01`); ms < Date.parse(`${year.year + 1}-01-01`); ms += 86_400_000) {
    const date = new Date(ms), day = date.toISOString().slice(0, 10);
    const expected = year.overrides.find((entry) => entry.date === day)?.classification ??
      ([0, 6].includes(date.getUTCDay()) ? 'WEEKEND' : year.holidays.includes(day) ? 'HOLIDAY' : 'REGULAR');
    assert.equal(sessionStatus(day), expected, day);
  }
  }
});
test('unknown future years and special sessions cannot claim or arm a normal trading tick', () => {
  for (const day of ['2026-11-08', '2027-01-04', '2028-02-29']) {
    const at = Date.parse(`${day}T14:20:00+05:30`);
    assert.equal(validClaimedTickId(`${day}:0`), false);
    assert.equal(assessAlarm({observedAtMs: at, scheduledAtMs: at,
      calendarVersion: NSE_FO_CALENDAR.revision}).shouldPoll, false);
  }
  const last = Date.parse('2026-12-31T15:29:40+05:30');
  assert.equal(assessAlarm({observedAtMs: last, scheduledAtMs: last,
    calendarVersion: NSE_FO_CALENDAR.revision}).nextAlarmAtMs, null);
  assert.equal(sessionStatus('2027-01-04'), null);
});
test('schema rejects contradictory, malformed or non-F&O provenance and regular overrides', () => {
  const mutations = [
    v => {v.segment = 'NSE_CM';}, v => {v.extra = true;}, v => {v.schema = 2;},
    v => {v.sources[0].url = 'https://example.com/FAOP71777.pdf';},
    v => {v.sources[0].sha256 = 'bad';}, v => {v.sources[0].publishedAt = '2026-12-31';},
    v => {v.sources.push(v.sources[0]);}, v => {v.years[0].annualSource = 'NSE/FAOP/72262';},
    v => {v.years[0].year = 2027;}, v => {v.years.push(v.years[0]);},
    v => {v.years[0].holidays.push('2026-02-30');}, v => {v.years[0].holidays.push('2026-12-26');},
    v => {v.years[0].holidays.reverse();}, v => {v.years[0].holidays.unshift('2026-01-15');},
    v => {v.years[0].overrides.push(v.years[0].overrides[1]);},
    v => {v.years[0].overrides[1].classification = 'REGULAR';},
    v => {v.years[0].overrides[1].automatedPaperSessionEligible = true;},
    v => {v.years[0].overrides[1].continuousCloseIst = '14:00';},
    v => {v.years[0].overrides[1].continuousOpenIst = null;},
    v => {v.years[0].overrides[1].source = 'NSE/FAOP/72262';},
  ];
  for (const mutate of mutations) {const v = clone(); mutate(v); assert.throws(() => validateCalendar(v));}
  const unknownTime = clone();
  Object.assign(unknownTime.years[0].overrides[1], {continuousOpenIst: null, continuousCloseIst: null});
  assert.equal(calendarSessionStatus(validateCalendar(unknownTime), '2026-11-08'), 'SPECIAL');
});
test('coverage inspection warns 45 days before expiry without claiming live re-verification', () => {
  assert.equal(calendarMaintenanceStatus(NSE_FO_CALENDAR, '2026-11-15').annualRefreshDue, false);
  assert.equal(calendarMaintenanceStatus(NSE_FO_CALENDAR, '2026-11-16').annualRefreshDue, true);
  const expired = calendarMaintenanceStatus(NSE_FO_CALENDAR, '2027-01-04');
  assert.equal(expired.sessionStatus, null); assert.equal(expired.liveReverified, false);
  assert.equal(expired.coveredThrough, '2026-12-31');
  assert.throws(() => calendarMaintenanceStatus(NSE_FO_CALENDAR, '2026-02-30'));
});
test('preparation requires matching PDF evidence and a new revision, never overwrites or promotes', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'calendar-stage-'));
  try {
    const candidatePath = path.join(directory, 'candidate.json'), pdfs = path.join(directory, 'pdfs');
    const output = path.join(directory, 'review'); mkdirSync(pdfs);
    const candidate = clone(), original = readFileSync(canonical);
    // Explicit synthetic local PDF bytes: this test does not certify NSE authenticity.
    const fakePdf = Buffer.from('%PDF-1.7\nSYNTHETIC calendar maintenance test only\n');
    for (const source of candidate.sources) {
      source.sha256 = createHash('sha256').update(fakePdf).digest('hex');
      writeFileSync(path.join(pdfs, `FAOP${source.id.split('/')[2]}.pdf`), fakePdf);
    }
    writeFileSync(candidatePath, JSON.stringify(candidate));
    assert.equal(runCalendarMaintenance(['prepare', candidatePath, pdfs, output], quiet), 1);
    candidate.revision += '-TEST'; writeFileSync(candidatePath, JSON.stringify(candidate));
    writeFileSync(path.join(pdfs, 'FAOP76940.pdf'), '%PDF-bad');
    assert.equal(runCalendarMaintenance(['prepare', candidatePath, pdfs, output], quiet), 1);
    assert.equal(existsSync(output), false);
    writeFileSync(path.join(pdfs, 'FAOP76940.pdf'), fakePdf);
    assert.equal(runCalendarMaintenance(['prepare', candidatePath, pdfs, output], quiet), 0);
    assert.match(readFileSync(path.join(output, 'REVIEW.txt'), 'utf8'), /STAGED ONLY/);
    assert.equal(runCalendarMaintenance(['prepare', candidatePath, pdfs, output], quiet), 1);
    assert.deepEqual(readFileSync(canonical), original);
    assert.equal(runCalendarMaintenance(['--deploy'], quiet), 2);
  } finally {rmSync(directory, {recursive: true, force: true});}
});
