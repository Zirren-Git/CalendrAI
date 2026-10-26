/**
 * Recurrence (an RFC 5545 subset) and occurrence expansion.
 *
 * Supported parts: FREQ (DAILY|WEEKLY|MONTHLY|YEARLY), INTERVAL, COUNT, UNTIL,
 * BYDAY, BYMONTHDAY, BYMONTH, WKST. Unsupported parts are rejected at parse
 * time instead of being silently ignored, so an imported rule can never behave
 * differently from what the user sees.
 */
import type {CalendarEvent, EventException, Occurrence} from './types';
import {
  addDaysToDateKey,
  dateKeyFromWall,
  localDateKey,
  parseDateKey,
  wallClockToUtc,
  weekdayOfDateKey,
  zonedParts,
} from './time';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RRule {
  freq: Freq;
  interval: number;
  count: number | null;
  until: number | null;
  byDay: number[] | null;
  byMonthDay: number[] | null;
  byMonth: number[] | null;
  weekStart: number;
}

const WEEKDAY_CODES: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};
const WEEKDAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const SUPPORTED_KEYS = new Set([
  'FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST',
]);

export class RRuleError extends Error {}

export function parseRRule(input: string | null | undefined): RRule | null {
  if (!input) {
    return null;
  }
  const trimmed = input.trim().replace(/^RRULE:/i, '');
  if (trimmed === '') {
    return null;
  }
  const rule: RRule = {
    freq: 'DAILY',
    interval: 1,
    count: null,
    until: null,
    byDay: null,
    byMonthDay: null,
    byMonth: null,
    weekStart: 1,
  };
  let sawFreq = false;
  for (const chunk of trimmed.split(';')) {
    if (chunk.trim() === '') {
      continue;
    }
    const [rawKey, rawValue] = chunk.split('=');
    const key = (rawKey ?? '').toUpperCase();
    const value = (rawValue ?? '').toUpperCase();
    if (!SUPPORTED_KEYS.has(key)) {
      throw new RRuleError(`Unsupported recurrence part: ${key}`);
    }
    switch (key) {
      case 'FREQ': {
        if (value !== 'DAILY' && value !== 'WEEKLY' && value !== 'MONTHLY' && value !== 'YEARLY') {
          throw new RRuleError(`Unsupported frequency: ${value}`);
        }
        rule.freq = value;
        sawFreq = true;
        break;
      }
      case 'INTERVAL': {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new RRuleError(`Invalid INTERVAL: ${value}`);
        }
        rule.interval = parsed;
        break;
      }
      case 'COUNT': {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new RRuleError(`Invalid COUNT: ${value}`);
        }
        rule.count = parsed;
        break;
      }
      case 'UNTIL': {
        rule.until = parseUntil(value);
        break;
      }
      case 'BYDAY': {
        const days = value.split(',').map(token => {
          const code = token.replace(/^[+-]?\d+/, '').slice(-2);
          const day = WEEKDAY_CODES[code];
          if (day === undefined) {
            throw new RRuleError(`Invalid BYDAY entry: ${token}`);
          }
          return day;
        });
        rule.byDay = uniqueSorted(days);
        break;
      }
      case 'BYMONTHDAY': {
        const days = value.split(',').map(token => {
          const parsed = Number(token);
          if (!Number.isInteger(parsed) || parsed === 0 || parsed < -31 || parsed > 31) {
            throw new RRuleError(`Invalid BYMONTHDAY entry: ${token}`);
          }
          return parsed;
        });
        rule.byMonthDay = uniqueSorted(days);
        break;
      }
      case 'BYMONTH': {
        const months = value.split(',').map(token => {
          const parsed = Number(token);
          if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
            throw new RRuleError(`Invalid BYMONTH entry: ${token}`);
          }
          return parsed;
        });
        rule.byMonth = uniqueSorted(months);
        break;
      }
      case 'WKST': {
        const day = WEEKDAY_CODES[value];
        if (day === undefined) {
          throw new RRuleError(`Invalid WKST: ${value}`);
        }
        rule.weekStart = day;
        break;
      }
      default:
        break;
    }
  }
  if (!sawFreq) {
    throw new RRuleError('Recurrence rule is missing FREQ');
  }
  return rule;
}

function uniqueSorted(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function parseUntil(value: string): number {
  // Two accepted forms: 20260131T140000Z and 20260131.
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59);
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(value);
  if (dateTime) {
    return Date.UTC(
      Number(dateTime[1]),
      Number(dateTime[2]) - 1,
      Number(dateTime[3]),
      Number(dateTime[4]),
      Number(dateTime[5]),
      Number(dateTime[6]),
    );
  }
  throw new RRuleError(`Invalid UNTIL: ${value}`);
}

export function buildRRule(rule: RRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) {
    parts.push(`INTERVAL=${rule.interval}`);
  }
  if (rule.count) {
    parts.push(`COUNT=${rule.count}`);
  }
  if (rule.until) {
    const d = new Date(rule.until);
    const pad = (n: number) => String(n).padStart(2, '0');
    parts.push(
      `UNTIL=${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
        d.getUTCHours(),
      )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`,
    );
  }
  if (rule.byDay) {
    parts.push(`BYDAY=${rule.byDay.map(d => WEEKDAY_NAMES[d]).join(',')}`);
  }
  if (rule.byMonthDay) {
    parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  }
  if (rule.byMonth) {
    parts.push(`BYMONTH=${rule.byMonth.join(',')}`);
  }
  if (rule.weekStart !== 1) {
    parts.push(`WKST=${WEEKDAY_NAMES[rule.weekStart]}`);
  }
  return parts.join(';');
}

export function describeRRule(rule: RRule | null): string {
  if (!rule) {
    return 'Does not repeat';
  }
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  switch (rule.freq) {
    case 'DAILY':
      return rule.interval === 1 ? 'Every day' : `Every ${rule.interval} days`;
    case 'WEEKLY': {
      if (rule.byDay && rule.byDay.length > 0) {
        const names = rule.byDay.map(d => days[d]?.slice(0, 3)).join(', ');
        return rule.interval === 1 ? `Every week on ${names}` : `Every ${rule.interval} weeks on ${names}`;
      }
      return rule.interval === 1 ? 'Every week' : `Every ${rule.interval} weeks`;
    }
    case 'MONTHLY':
      return rule.interval === 1 ? 'Every month' : `Every ${rule.interval} months`;
    case 'YEARLY':
      return rule.interval === 1 ? 'Every year' : `Every ${rule.interval} years`;
    default:
      return 'Repeats';
  }
}

export const MAX_OCCURRENCES = 5000;

export interface ExpandOptions {
  rangeStart: number;
  rangeEnd: number;
  exceptions?: EventException[];
  /** Hard cap on generated instances (protects against pathological rules). */
  limit?: number;
  /** Overrides keyed by occurrence start, already materialised as events. */
  overrides?: CalendarEvent[];
}

interface LocalSeries {
  startKey: string;
  hour: number;
  minute: number;
  durationMs: number;
  allDay: boolean;
}

function seriesFromEvent(event: CalendarEvent): LocalSeries {
  const p = zonedParts(event.start, event.timezone);
  return {
    startKey: dateKeyFromWall(p),
    hour: p.hour,
    minute: p.minute,
    durationMs: Math.max(0, event.end - event.start),
    allDay: event.allDay,
  };
}

function localStartUtc(key: string, hour: number, minute: number, tz: string): number {
  const {year, month, day} = parseDateKey(key);
  return wallClockToUtc({year, month, day, hour, minute}, tz);
}

/**
 * Expands one event (optionally recurring) into occurrences overlapping
 * [rangeStart, rangeEnd]. Cancelled exceptions are dropped; modified
 * exceptions are returned in place of the generated instance.
 */
export function expandEvent(event: CalendarEvent, options: ExpandOptions): Occurrence[] {
  const lim = options.limit ?? MAX_OCCURRENCES;
  const exceptions = options.exceptions ?? [];
  const overrides = options.overrides ?? [];
  const cancelled = new Set(exceptions.filter(e => e.cancelled).map(e => e.occurrenceStart));
  const overrideByStart = new Map(overrides.map(o => [o.occurrenceOriginalStart ?? 0, o]));

  const rule = parseRRule(event.rrule);
  if (!rule || event.exceptionParentId) {
    if (event.start <= options.rangeEnd && event.end >= options.rangeStart) {
      return [
        {
          eventId: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          allDay: event.allDay,
          color: event.color,
          location: event.location,
          notes: event.notes,
          timezone: event.timezone,
          occurrenceStart: event.start,
          recurring: Boolean(event.rrule) && !event.exceptionParentId,
          isOverride: Boolean(event.exceptionParentId),
        },
      ];
    }
    return [];
  }

  const series = seriesFromEvent(event);
  const results: Occurrence[] = [];
  let produced = 0;
  const hardStop = Math.min(lim, MAX_OCCURRENCES);

  for (const startKey of candidateDateKeys(series.startKey, rule, hardStop * 3)) {
    if (produced >= hardStop) {
      break;
    }
    const start = localStartUtc(startKey, series.hour, series.minute, event.timezone);
    if (rule.until !== null && start > rule.until) {
      break;
    }
    const end = series.allDay ? start + 86_400_000 : start + series.durationMs;
    const occurrenceStart = start;

    const override = overrideByStart.get(occurrenceStart);
    produced += 1;
    if (rule.count !== null && produced > rule.count) {
      break;
    }
    if (cancelled.has(occurrenceStart)) {
      continue;
    }
    if (start > options.rangeEnd) {
      break;
    }
    const effective = override ?? event;
    const effectiveEnd = override ? override.end : end;
    if (effectiveEnd < options.rangeStart || (override ? override.start : start) > options.rangeEnd) {
      // Keep scanning: later instances are also out of range only if sorted,
      // which candidateDateKeys guarantees.
      if ((override ? override.start : start) > options.rangeEnd) {
        break;
      }
      continue;
    }
    results.push({
      eventId: effective.id,
      title: effective.title,
      start: override ? override.start : start,
      end: effectiveEnd,
      allDay: effective.allDay,
      color: effective.color,
      location: effective.location,
      notes: effective.notes,
      timezone: effective.timezone,
      occurrenceStart: override ? override.start : occurrenceStart,
      recurring: true,
      isOverride: Boolean(override),
    });
  }
  return results;
}

/**
 * Yields local date keys for a rule in chronological order. Generation is
 * bounded (maxSteps) so a malformed rule can never spin forever.
 */
export function* candidateDateKeys(
  startKey: string,
  rule: RRule,
  maxSteps: number,
): Generator<string> {
  const start = parseDateKey(startKey);
  const anchorWeekday = weekdayOfDateKey(startKey);
  let steps = 0;

  if (rule.freq === 'DAILY') {
    let key = startKey;
    while (steps < maxSteps) {
      yield key;
      key = addDaysToDateKey(key, rule.interval);
      steps += 1;
    }
    return;
  }

  if (rule.freq === 'WEEKLY') {
    const days = rule.byDay && rule.byDay.length > 0 ? rule.byDay : [anchorWeekday];
    // Align the first week to the rule's week start.
    const offsetToWeekStart = (anchorWeekday - rule.weekStart + 7) % 7;
    let weekStart = addDaysToDateKey(startKey, -offsetToWeekStart);
    while (steps < maxSteps) {
      const ordered = [...days].sort(
        (a, b) => ((a - rule.weekStart + 7) % 7) - ((b - rule.weekStart + 7) % 7),
      );
      for (const day of ordered) {
        const shift = (day - rule.weekStart + 7) % 7;
        const candidate = addDaysToDateKey(weekStart, shift);
        if (candidate >= startKey) {
          yield candidate;
        }
      }
      weekStart = addDaysToDateKey(weekStart, 7 * rule.interval);
      steps += 1;
    }
    return;
  }

  if (rule.freq === 'MONTHLY') {
    let cursorYear = start.year;
    let cursorMonth = start.month;
    const monthDays = rule.byMonthDay ?? [start.day];
    while (steps < maxSteps) {
      const daysInMonth = new Date(Date.UTC(cursorYear, cursorMonth, 0)).getUTCDate();
      for (const rawDay of [...monthDays].sort((a, b) => a - b)) {
        const day = rawDay > 0 ? rawDay : daysInMonth + rawDay + 1;
        if (day < 1 || day > daysInMonth) {
          continue;
        }
        const key = dateKeyFromWall({year: cursorYear, month: cursorMonth, day});
        if (key >= startKey) {
          yield key;
        }
      }
      cursorMonth += rule.interval;
      while (cursorMonth > 12) {
        cursorMonth -= 12;
        cursorYear += 1;
      }
      steps += 1;
    }
    return;
  }

  // YEARLY
  const months = rule.byMonth ?? [start.month];
  const monthDays = rule.byMonthDay ?? [start.day];
  let year = start.year;
  while (steps < maxSteps) {
    for (const month of [...months].sort((a, b) => a - b)) {
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (const rawDay of [...monthDays].sort((a, b) => a - b)) {
        const day = rawDay > 0 ? rawDay : daysInMonth + rawDay + 1;
        if (day < 1 || day > daysInMonth) {
          continue;
        }
        const key = dateKeyFromWall({year, month, day});
        if (key >= startKey && (rule.byMonth !== null || month === start.month)) {
          yield key;
        }
      }
    }
    year += rule.interval;
    steps += 1;
  }
}

/** True when the event has an instance on that local date. */
export function occursOnLocalDate(
  event: CalendarEvent,
  localDate: string,
  exceptions: EventException[] = [],
): boolean {
  const rule = parseRRule(event.rrule);
  if (!rule) {
    return localDateKey(event.start, event.timezone) === localDate;
  }
  const {year, month, day} = parseDateKey(localDate);
  const dayStart = wallClockToUtc({year, month, day, hour: 0, minute: 0}, event.timezone);
  const occurrences = expandEvent(event, {
    rangeStart: dayStart,
    rangeEnd: dayStart + 86_400_000,
    exceptions,
  });
  return occurrences.length > 0;
}

