const formatterCache = new Map<string, Intl.DateTimeFormat>();
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

function formatterFor(timezone: string) {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timezone: string): DateParts {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return values as unknown as DateParts;
}

function sameLocalTime(parts: DateParts, expected: DateParts) {
  return parts.year === expected.year
    && parts.month === expected.month
    && parts.day === expected.day
    && parts.hour === expected.hour
    && parts.minute === expected.minute
    && parts.second === expected.second;
}

function daysInMonth(year: number, month: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCDate();
}

export function isValidTimezone(timezone: string) {
  try {
    formatterFor(timezone).format(new Date());
    return true;
  } catch {
    formatterCache.delete(timezone);
    return false;
  }
}

export function localObservationToUtc(dateValue: string, timeValue: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}$/.test(timeValue)) {
    throw new Error('日付と時刻を入力してください。');
  }
  if (!isValidTimezone(timezone)) throw new Error('タイムゾーンが正しくありません。');

  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour, minute] = timeValue.split(':').map(Number);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`${MIN_YEAR}年から${MAX_YEAR}年までの有効な日時を入力してください。`);
  }

  const expected: DateParts = { year, month, day, hour, minute, second: 0 };
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  const dayMs = 86_400_000;
  const offsets = new Set<number>();

  // Collect offsets around the target so daylight-saving transitions are represented.
  for (const delta of [-2, -1, 0, 1, 2]) {
    const probe = target + delta * dayMs;
    const parts = zonedParts(new Date(probe), timezone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    offsets.add(represented - probe);
  }

  const candidates = [...offsets]
    .map((offset) => new Date(target - offset))
    .filter((candidate) => sameLocalTime(zonedParts(candidate, timezone), expected))
    .sort((left, right) => left.getTime() - right.getTime());

  if (candidates.length === 0) {
    throw new Error('指定時刻は夏時間への切り替えにより存在しません。別の時刻を指定してください。');
  }

  // During a repeated autumn clock hour, consistently use the first occurrence.
  return candidates[0];
}

export function formatObservationDate(dateValue: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return '日付を入力してください';
  const [year, month, day] = dateValue.split('-').map(Number);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return '日付を入力してください';
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

export function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
}
