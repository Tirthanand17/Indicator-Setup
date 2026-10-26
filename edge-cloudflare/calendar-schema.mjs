/** Offline manifest validation. Provenance declarations are not proof of authenticity. */
const fail = () => { throw new Error('INVALID_NSE_FO_CALENDAR'); };
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === names.split(' ').sort().join(',');
export function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function validateCalendar(value) {
  if (!keys(value, 'schema segment timezone revision reviewedAt sources years') || value.schema !== 1 ||
      value.segment !== 'NSE_FO' || value.timezone !== 'Asia/Kolkata' ||
      typeof value.revision !== 'string' || !/^NSE-FO-[A-Z0-9-]{1,100}$/.test(value.revision) ||
      !validCalendarDate(value.reviewedAt) || !Array.isArray(value.sources) ||
      value.sources.length < 1 || value.sources.length > 100 || !Array.isArray(value.years) ||
      value.years.length < 1 || value.years.length > 10) fail();
  const sources = new Map();
  for (const source of value.sources) {
    if (!keys(source, 'id publishedAt url sha256 kind calendarYear') ||
        typeof source.id !== 'string' || !/^NSE\/FAOP\/\d{5,6}$/.test(source.id) || sources.has(source.id) ||
        !validCalendarDate(source.publishedAt) || source.publishedAt > value.reviewedAt ||
        source.url !== `https://nsearchives.nseindia.com/content/circulars/FAOP${source.id.split('/')[2]}.pdf` ||
        typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256) ||
        !['ANNUAL', 'AMENDMENT', 'SPECIAL'].includes(source.kind) ||
        !Number.isInteger(source.calendarYear) || source.calendarYear < 2000 || source.calendarYear > 2099) fail();
    sources.set(source.id, source);
  }
  const used = new Set(); let previousYear = 0;
  for (const year of value.years) {
    if (!keys(year, 'year annualSource holidays overrides') || !Number.isInteger(year.year) ||
        year.year <= previousYear || year.year < 2000 || year.year > 2099 ||
        !Array.isArray(year.holidays) || year.holidays.length < 1 || year.holidays.length > 100 ||
        !Array.isArray(year.overrides) || year.overrides.length > 100) fail();
    previousYear = year.year;
    const annual = sources.get(year.annualSource);
    if (!annual || annual.kind !== 'ANNUAL' || annual.calendarYear !== year.year) fail();
    used.add(annual.id);
    let previousDate = '';
    for (const day of year.holidays) {
      if (!validCalendarDate(day) || !day.startsWith(`${year.year}-`) || day <= previousDate ||
          [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())) fail();
      previousDate = day;
    }
    previousDate = '';
    for (const override of year.overrides) {
      const special = override?.classification === 'SPECIAL';
      if (!keys(override, special ? 'date classification source continuousOpenIst continuousCloseIst automatedPaperSessionEligible' :
        'date classification source') || !['SPECIAL', 'HOLIDAY'].includes(override.classification) ||
          !validCalendarDate(override.date) || !override.date.startsWith(`${year.year}-`) ||
          override.date <= previousDate || year.holidays.includes(override.date)) fail();
      previousDate = override.date;
      const source = sources.get(override.source);
      if (!source || source.calendarYear !== year.year || source.kind !== (special ? 'SPECIAL' : 'AMENDMENT')) fail();
      used.add(source.id);
      if (special) {
        const {continuousOpenIst: open, continuousCloseIst: close} = override;
        const time = (v) => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
        if (override.automatedPaperSessionEligible !== false ||
            !((open === null && close === null) || (time(open) && time(close) && open < close))) fail();
      }
    }
  }
  if (sources.size !== used.size) fail();
  return value;
}

export function calendarSessionStatus(calendar, day) {
  if (!validCalendarDate(day)) return null;
  const year = calendar.years.find((entry) => entry.year === Number(day.slice(0, 4)));
  if (!year) return null;
  const override = year.overrides.find((entry) => entry.date === day);
  if (override) return override.classification;
  if ([0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())) return 'WEEKEND';
  return year.holidays.includes(day) ? 'HOLIDAY' : 'REGULAR';
}

export function calendarMaintenanceStatus(calendar, day) {
  if (!validCalendarDate(day)) throw new Error('INVALID_INSPECTION_DATE');
  const coveredThrough = `${calendar.years.at(-1).year}-12-31`;
  const remainingDays = Math.floor((Date.parse(`${coveredThrough}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  return {revision: calendar.revision, reviewedAt: calendar.reviewedAt, coveredThrough,
    coveredYears: calendar.years.map((entry) => entry.year),
    sessionStatus: calendarSessionStatus(calendar, day),
    annualRefreshDue: remainingDays <= 45, daysUntilCoverageEnds: remainingDays,
    liveReverified: false};
}
