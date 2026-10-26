/**
 * Timezone and daylight-saving handling.
 *
 * All timestamps are stored as UTC epoch milliseconds; a wall-clock time is
 * always interpreted in the event's IANA zone. Conversion uses Intl, which on
 * Android is backed by the platform ICU database (full IANA data since API 24
 * via the Hermes Intl implementation).
 *
 * DST edge cases:
 *  - spring-forward gap (e.g. 02:30 in America/New_York): the requested wall
 *    time does not exist, so it is normalised forward to 03:30.
 *  - fall-back overlap (01:30 occurs twice): the earlier (+ offset) instance wins.
 */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) {
    return cached;
  }
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, created);
  return created;
}

export interface ZonedParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday */
  weekday: number;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone});
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(utcMs: number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        // ICU can emit "24" for midnight in some locales; normalise it.
        hour = Number(part.value) % 24;
        break;
      case 'minute':
        minute = Number(part.value);
        break;
      case 'second':
        second = Number(part.value);
        break;
      default:
        break;
    }
  }
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {year, month, day, hour, minute, second, weekday};
}

/** Offset of the zone at that instant, in ms (local wall time minus UTC). */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const p = zonedParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

/** Converts a wall-clock time in `timeZone` to a UTC instant. */
export function wallClockToUtc(wall: WallClock, timeZone: string): number {
  const target = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second ?? 0,
  );
  // Two-pass fixed point: offsets are stable within an hour of the guess.
  let guess = target;
  for (let i = 0; i < 4; i += 1) {
    const offset = zoneOffsetMs(guess, timeZone);
    const next = target - offset;
    if (next === guess) {
      break;
    }
    guess = next;
  }
  const roundTrip = zonedParts(guess, timeZone);
  const matched =
    roundTrip.year === wall.year &&
    roundTrip.month === wall.month &&
    roundTrip.day === wall.day &&
    roundTrip.hour === wall.hour &&
    roundTrip.minute === wall.minute;
  if (matched) {
    return guess;
  }
  // The requested time fell into a spring-forward gap (it does not exist).
  // Convert with the offsets on both sides of the transition and take the
  // later instant, which is the first existing wall time after the gap:
  // 02:30 on a US spring-forward day becomes 03:30 local time.
  const offsetBefore = zoneOffsetMs(guess - 12 * 3600_000, timeZone);
  const offsetAfter = zoneOffsetMs(guess + 12 * 3600_000, timeZone);
  const beforeInstant = target - offsetBefore;
  const afterInstant = target - offsetAfter;
  return Math.max(beforeInstant, afterInstant);
}

export function dateKeyFromWall(wall: {year: number; month: number; day: number}): string {
  const y = String(wall.year).padStart(4, '0');
  const m = String(wall.month).padStart(2, '0');
  const d = String(wall.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function localDateKey(utcMs: number, timeZone: string): string {
  return dateKeyFromWall(zonedParts(utcMs, timeZone));
}

export function parseDateKey(key: string): {year: number; month: number; day: number} {
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) {
    throw new Error(`Invalid date key: ${key}`);
  }
  return {year: y, month: m, day: d};
}

/** Adds days to a YYYY-MM-DD key without any timezone drift. */
export function addDaysToDateKey(key: string, days: number): string {
  const {year, month, day} = parseDateKey(key);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return dateKeyFromWall({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

export function weekdayOfDateKey(key: string): number {
  const {year, month, day} = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function daysBetweenDateKeys(a: string, b: string): number {
  const pa = parseDateKey(a);
  const pb = parseDateKey(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) /
      86_400_000,
  );
}

/** Inclusive list of date keys. */
export function dateKeyRange(startKey: string, endKey: string): string[] {
  const total = daysBetweenDateKeys(startKey, endKey);
  const keys: string[] = [];
  for (let i = 0; i <= total; i += 1) {
    keys.push(addDaysToDateKey(startKey, i));
  }
  return keys;
}

export function startOfLocalDay(utcMs: number, timeZone: string): number {
  const p = zonedParts(utcMs, timeZone);
  return wallClockToUtc({year: p.year, month: p.month, day: p.day, hour: 0, minute: 0}, timeZone);
}

export function endOfLocalDay(utcMs: number, timeZone: string): number {
  const p = zonedParts(utcMs, timeZone);
  const nextKey = addDaysToDateKey(dateKeyFromWall(p), 1);
  const next = parseDateKey(nextKey);
  return (
    wallClockToUtc({year: next.year, month: next.month, day: next.day, hour: 0, minute: 0}, timeZone) - 1
  );
}

export function startOfLocalWeek(utcMs: number, timeZone: string, weekStartsOn: 0 | 1): number {
  const p = zonedParts(utcMs, timeZone);
  const shift = (p.weekday - weekStartsOn + 7) % 7;
  const key = addDaysToDateKey(dateKeyFromWall(p), -shift);
  const {year, month, day} = parseDateKey(key);
  return wallClockToUtc({year, month, day, hour: 0, minute: 0}, timeZone);
}

export function localDayRange(utcMs: number, timeZone: string): {start: number; end: number} {
  const p = zonedParts(utcMs, timeZone);
  const start = wallClockToUtc({year: p.year, month: p.month, day: p.day, hour: 0, minute: 0}, timeZone);
  const nextKey = addDaysToDateKey(dateKeyFromWall(p), 1);
  const next = parseDateKey(nextKey);
  const end = wallClockToUtc({year: next.year, month: next.month, day: next.day, hour: 0, minute: 0}, timeZone) - 1;
  return {start, end};
}

/** Minutes since local midnight, used for workday / free-time windows. */
export function minutesIntoLocalDay(utcMs: number, timeZone: string): number {
  const p = zonedParts(utcMs, timeZone);
  return p.hour * 60 + p.minute;
}

export function atLocalMinute(utcMs: number, timeZone: string, minuteOfDay: number): number {
  const p = zonedParts(utcMs, timeZone);
  return wallClockToUtc(
    {
      year: p.year,
      month: p.month,
      day: p.day,
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
    },
    timeZone,
  );
}

export function detectTimeZone(): string {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && isValidTimeZone(zone)) {
      return zone;
    }
  } catch {
    // fall through
  }
  return 'UTC';
}

export function formatTime(utcMs: number, timeZone: string, clock24h: boolean): string {
  const p = zonedParts(utcMs, timeZone);
  if (clock24h) {
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  }
  const suffix = p.hour < 12 ? 'AM' : 'PM';
  const hour = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${hour}:${String(p.minute).padStart(2, '0')} ${suffix}`;
}

export function formatDateKey(key: string, style: 'short' | 'medium' | 'long' = 'medium'): string {
  const {year, month, day} = parseDateKey(key);
  const date = new Date(Date.UTC(year, month - 1, day));
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthName = months[month - 1] ?? '';
  if (style === 'short') {
    return `${monthName} ${day}`;
  }
  if (style === 'long') {
    return `${weekdays[date.getUTCDay()]}, ${monthName} ${day}, ${year}`;
  }
  return `${monthName} ${day}, ${year}`;
}

export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) {
    return `${mins}m`;
  }
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

export function isoWeekStartKey(utcMs: number, timeZone: string): string {
  const p = zonedParts(utcMs, timeZone);
  const shift = (p.weekday + 6) % 7; // Monday-based
  return addDaysToDateKey(dateKeyFromWall(p), -shift);
}
