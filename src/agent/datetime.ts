/**
 * Deterministic date/time resolution for spoken and typed commands.
 *
 * This is deliberately rule-based, not an LLM: the same phrase always resolves
 * to the same instant given the same clock and timezone, and every rule is
 * covered by tests. Relative dates resolve against the user's local wall clock
 * in their calendar timezone, so DST transitions cannot shift a "9am" event.
 */
import {
  addDaysToDateKey,
  dateKeyFromWall,
  localDateKey,
  parseDateKey,
  wallClockToUtc,
  weekdayOfDateKey,
  zonedParts,
} from '../domain/time';

export interface TemporalContext {
  now: number;
  timeZone: string;
  defaultEventMinutes: number;
  /** Hour used when a command names a day and a duration but no clock time. */
  defaultHour?: number;
}

export interface TemporalResult {
  start: number;
  end: number;
  allDay: boolean;
  hasDate: boolean;
  hasTime: boolean;
  recurrence: string | null;
  /** Ranges of the input consumed by date/time words, for title extraction. */
  consumed: [number, number][];
  confidence: number;
  notes: string[];
}

type Kind = 'date' | 'time' | 'duration' | 'offset' | 'recurrence' | 'inline';

interface Candidate {
  kind: Kind;
  index: number;
  length: number;
  value: unknown;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
  forty: 40, fortyfive: 45, sixty: 60, ninety: 90,
};

function parseCount(token: string): number | null {
  const numeric = Number(token);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  const word = NUMBER_WORDS[token.toLowerCase()];
  return word ?? null;
}

/** "3pm", "15:30", "at 9" (ambiguous am/pm) → 24h clock. */
export function parseClock(raw: string): {hour: number; minute: number; explicit: boolean} | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(raw.trim());
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase().replace(/\./g, '');
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) {
    return null;
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    hour = hour % 12;
    if (meridiem === 'pm') {
      hour += 12;
    }
    return {hour, minute, explicit: true};
  }
  if (hour > 23) {
    return null;
  }
  return {hour, minute, explicit: false};
}

function localKey(now: number, timeZone: string): string {
  return localDateKey(now, timeZone);
}

function atDateKey(key: string, hour: number, minute: number, timeZone: string): number {
  const {year, month, day} = parseDateKey(key);
  return wallClockToUtc({year, month, day, hour, minute}, timeZone);
}

function nextWeekdayKey(baseKey: string, target: number, includeToday: boolean): string {
  const baseWeekday = weekdayOfDateKey(baseKey);
  let delta = (target - baseWeekday + 7) % 7;
  if (delta === 0 && !includeToday) {
    delta = 7;
  }
  return addDaysToDateKey(baseKey, delta);
}

function upcomingMonthDay(baseKey: string, month: number, day: number): string | null {
  const base = parseDateKey(baseKey);
  const daysInMonth = new Date(Date.UTC(base.year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    return null;
  }
  const candidate = dateKeyFromWall({year: base.year, month, day});
  if (candidate >= baseKey) {
    return candidate;
  }
  return dateKeyFromWall({year: base.year + 1, month, day});
}

interface TimeCandidate {
  hour: number;
  minute: number;
  explicit: boolean;
}

function scanCandidates(text: string, ctx: TemporalContext): Candidate[] {
  const candidates: Candidate[] = [];
  const lower = text.toLowerCase();
  const add = (index: number, length: number, kind: Kind, value: unknown) => {
    candidates.push({kind, index, length, value});
  };

  // "in 20 minutes" / "in two hours" / "in 3 days"
  for (const match of lower.matchAll(
    /\bin\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|sixty)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/g,
  )) {
    const count = parseCount(match[1]!);
    if (count === null) {
      continue;
    }
    const unit = match[2]!;
    const ms = unit.startsWith('min') ? count * 60_000
      : unit.startsWith('h') ? count * 3_600_000
      : unit.startsWith('d') ? count * 86_400_000
      : count * 7 * 86_400_000;
    add(match.index!, match[0].length, 'offset', {ms, count, unit});
  }

  // "from 2 to 3pm" / "between 2 and 4" / "2-3pm"
  for (const match of lower.matchAll(
    /\b(?:from|between)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:to|and|-|until)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/g,
  )) {
    const from = parseClock(match[1]!);
    const to = parseClock(match[2]!);
    if (from && to) {
      add(match.index!, match[0].length, 'inline', {start: from, end: to});
    }
  }
  for (const match of lower.matchAll(/\b(\d{1,2})\s*-\s*(\d{1,2})\s*(am|pm)\b/g)) {
    const from = parseClock(`${match[1]}${match[3]}`);
    const to = parseClock(`${match[2]}${match[3]}`);
    if (from && to) {
      add(match.index!, match[0].length, 'inline', {start: from, end: to});
    }
  }

  // "for 30 minutes" / "lasting an hour"
  for (const match of lower.matchAll(
    /\b(?:for|lasting)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|sixty|half\s+an)\s*(minutes?|mins?|hours?|hrs?)\b/g,
  )) {
    if (match[1]!.startsWith('half')) {
      add(match.index!, match[0].length, 'duration', {minutes: 30});
      continue;
    }
    const count = parseCount(match[1]!);
    if (count === null) {
      continue;
    }
    add(match.index!, match[0].length, 'duration', {
      minutes: match[2]!.startsWith('h') ? count * 60 : count,
    });
  }
  // "30 minute" / "1 hour" (duration without a preposition)
  for (const match of lower.matchAll(/\b(\d+)\s*(?:minute|min|hour|hr)s?\b/g)) {
    if (candidates.some(c => match.index! >= c.index && match.index! < c.index + c.length)) {
      continue;
    }
    const count = Number(match[1]);
    if (count < 1 || count > 24 * 60) {
      continue;
    }
    add(match.index!, match[0].length, 'duration', {
      minutes: /h/.test(match[0]) ? count * 60 : count,
    });
  }

  // Recurrence
  for (const match of lower.matchAll(
    /\bevery\s+(other\s+)?(day|week|month|year|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/g,
  )) {
    const other = Boolean(match[1]);
    const unit = match[2]!;
    const interval = other ? 2 : 1;
    let rrule: string | null = null;
    if (unit === 'day') {
      rrule = `FREQ=DAILY${interval > 1 ? `;INTERVAL=${interval}` : ''}`;
    } else if (unit === 'week') {
      rrule = `FREQ=WEEKLY${interval > 1 ? `;INTERVAL=${interval}` : ''}`;
    } else if (unit === 'month') {
      rrule = `FREQ=MONTHLY${interval > 1 ? `;INTERVAL=${interval}` : ''}`;
    } else if (unit === 'year') {
      rrule = `FREQ=YEARLY${interval > 1 ? `;INTERVAL=${interval}` : ''}`;
    } else if (unit === 'weekday') {
      rrule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    } else {
      const day = WEEKDAYS[unit];
      if (day !== undefined) {
        const code = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][day];
        rrule = `FREQ=WEEKLY;BYDAY=${code}${interval > 1 ? `;INTERVAL=${interval}` : ''}`;
      }
    }
    if (rrule) {
      add(match.index!, match[0].length, 'recurrence', {rrule});
    }
  }
  for (const match of lower.matchAll(/\b(daily|weekdays|weekly|monthly|yearly)\b/g)) {
    if (candidates.some(c => match.index! >= c.index && match.index! < c.index + c.length)) {
      continue;
    }
    const word = match[1]!;
    const rrule =
      word === 'daily' ? 'FREQ=DAILY'
      : word === 'weekdays' ? 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
      : word === 'weekly' ? 'FREQ=WEEKLY'
      : word === 'monthly' ? 'FREQ=MONTHLY'
      : 'FREQ=YEARLY';
    add(match.index!, match[0].length, 'recurrence', {rrule});
  }

  // Explicit dates: today / tomorrow / tonight / weekday / month day / numeric
  const baseKey = localKey(ctx.now, ctx.timeZone);
  for (const match of lower.matchAll(
    /\b(today|tomorrow|tonight|yesterday|day after tomorrow|next week|next month)\b/g,
  )) {
    const word = match[1]!;
    if (word === 'tonight') {
      add(match.index!, match[0].length, 'date', {key: baseKey, night: true});
      continue;
    }
    let key = baseKey;
    if (word === 'tomorrow') {
      key = addDaysToDateKey(baseKey, 1);
    } else if (word === 'yesterday') {
      key = addDaysToDateKey(baseKey, -1);
    } else if (word === 'day after tomorrow') {
      key = addDaysToDateKey(baseKey, 2);
    } else if (word === 'next week') {
      key = addDaysToDateKey(baseKey, 7);
    } else if (word === 'next month') {
      const p = parseDateKey(baseKey);
      const month = p.month === 12 ? 1 : p.month + 1;
      const year = p.month === 12 ? p.year + 1 : p.year;
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      key = dateKeyFromWall({year, month, day: Math.min(p.day, daysInMonth)});
    }
    add(match.index!, match[0].length, 'date', {key});
  }

  for (const match of lower.matchAll(
    /\b(next|this|coming|on)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/g,
  )) {
    // Avoid re-reading the weekday inside an already matched recurrence phrase.
    if (candidates.some(c => match.index! >= c.index && match.index! < c.index + c.length)) {
      continue;
    }
    const qualifier = match[1];
    const day = WEEKDAYS[match[2]!];
    if (day === undefined) {
      continue;
    }
    const includeToday = qualifier === 'this';
    add(match.index!, match[0].length, 'date', {
      key: nextWeekdayKey(baseKey, day, includeToday),
      weekday: day,
    });
  }

  for (const match of lower.matchAll(
    /\b(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/g,
  )) {
    const month = MONTHS[match[1]!];
    const day = Number(match[2]);
    if (!month) {
      continue;
    }
    const key = upcomingMonthDay(baseKey, month, day);
    if (key) {
      add(match.index!, match[0].length, 'date', {key});
    }
  }

  for (const match of lower.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    let year = match[3] ? Number(match[3]) : undefined;
    if (year !== undefined && year < 100) {
      year += 2000;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      continue;
    }
    const base = parseDateKey(baseKey);
    const candidateYear = year ?? base.year;
    const daysInMonth = new Date(Date.UTC(candidateYear, month, 0)).getUTCDate();
    if (day > daysInMonth) {
      continue;
    }
    let key = dateKeyFromWall({year: candidateYear, month, day});
    if (year === undefined && key < baseKey) {
      key = dateKeyFromWall({year: candidateYear + 1, month, day});
    }
    add(match.index!, match[0].length, 'date', {key});
  }

  for (const match of lower.matchAll(/\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/g)) {
    const day = Number(match[1]);
    if (day < 1 || day > 31) {
      continue;
    }
    const base = parseDateKey(baseKey);
    const daysThisMonth = new Date(Date.UTC(base.year, base.month, 0)).getUTCDate();
    if (day > daysThisMonth) {
      continue;
    }
    let key = dateKeyFromWall({year: base.year, month: base.month, day});
    if (key < baseKey) {
      const month = base.month === 12 ? 1 : base.month + 1;
      const year = base.month === 12 ? base.year + 1 : base.year;
      key = dateKeyFromWall({year, month, day});
    }
    add(match.index!, match[0].length, 'date', {key});
  }

  // Times of day
  for (const match of lower.matchAll(/\b(?:at|by|around)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/g)) {
    const clock = parseClock(match[0].replace(/^\s*(at|by|around)\s*/, ''));
    if (clock) {
      add(match.index!, match[0].length, 'time', clock);
    }
  }
  for (const match of lower.matchAll(/\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:st|nd|rd|th|am|pm))/g)) {
    if (candidates.some(c => match.index! >= c.index && match.index! < c.index + c.length)) {
      continue;
    }
    const clock = parseClock(`${match[1]}${match[2] ? `:${match[2]}` : ''}`);
    if (clock) {
      add(match.index!, match[0].length, 'time', clock);
    }
  }
  for (const match of lower.matchAll(/\b(\d{1,2}):(\d{2})\b(?!\s*(?:am|pm))/g)) {
    if (candidates.some(c => match.index! >= c.index && match.index! < c.index + c.length)) {
      continue;
    }
    const clock = parseClock(match[0]);
    if (clock && clock.hour >= 0 && clock.hour <= 23) {
      add(match.index!, match[0].length, 'time', clock);
    }
  }
  for (const match of lower.matchAll(/\b(noon|midday|midnight|morning|afternoon|evening)\b/g)) {
    const word = match[1]!;
    const clock: TimeCandidate =
      word === 'noon' || word === 'midday' ? {hour: 12, minute: 0, explicit: true}
      : word === 'midnight' ? {hour: 0, minute: 0, explicit: true}
      : word === 'morning' ? {hour: 9, minute: 0, explicit: false}
      : word === 'afternoon' ? {hour: 14, minute: 0, explicit: false}
      : {hour: 19, minute: 0, explicit: false};
    add(match.index!, match[0].length, 'time', clock);
  }

  return candidates.sort((a, b) => a.index - b.index);
}

function overlap(a: Candidate, b: Candidate): boolean {
  return a.index < b.index + b.length && b.index < a.index + a.length;
}

/**
 * Resolves the temporal parts of a command. Returns the best single instant
 * range plus the spans that were consumed, so the caller can use the rest of
 * the sentence as the title.
 */
export function resolveTemporal(
  text: string,
  ctx: TemporalContext,
): TemporalResult {
  const candidates = scanCandidates(text, ctx);
  const notes: string[] = [];
  const consumed: [number, number][] = [];
  const baseKey = localKey(ctx.now, ctx.timeZone);
  const eat = (c: Candidate) => {
    consumed.push([c.index, c.index + c.length]);
  };

  const recurrences = candidates.filter(c => c.kind === 'recurrence');
  const offsets = candidates.filter(c => c.kind === 'offset');
  const inlines = candidates.filter(c => c.kind === 'inline');
  const durations = candidates.filter(c => c.kind === 'duration');
  // A "time" candidate inside an inline range is redundant.
  const times = candidates.filter(
    c => c.kind === 'time' && !inlines.some(i => overlap(i, c)),
  );
  const dates = candidates.filter(c => c.kind === 'date');
  // "3pm" produces both a time and (via the numeric-date rule) nothing else;
  // drop date candidates that overlap a time candidate.
  const cleanDates = dates.filter(d => !times.some(t => overlap(t, d)) && !inlines.some(i => overlap(i, d)));

  let recurrence: string | null = null;
  if (recurrences.length > 0) {
    recurrence = (recurrences[0]!.value as {rrule: string}).rrule;
    for (const r of recurrences) {
      eat(r);
    }
    if (recurrences.length > 1) {
      notes.push('Multiple repeat patterns found; using the first.');
    }
  }

  const durationMinutes = (() => {
    if (durations.length === 0) {
      return null;
    }
    const first = durations[0]!.value as {minutes: number};
    eat(durations[0]!);
    if (durations.length > 1) {
      notes.push('Multiple durations found; using the first.');
    }
    return first.minutes;
  })();

  let allDay = false;
  let hasDate = false;
  let hasTime = false;
  let start: number;
  let end: number;
  let confidence = 0.92;

  if (offsets.length > 0) {
    const offset = offsets[0]!.value as {ms: number};
    eat(offsets[0]!);
    start = ctx.now + offset.ms;
    hasTime = true;
    const minutes = durationMinutes ?? ctx.defaultEventMinutes;
    end = start + minutes * 60_000;
  } else if (inlines.length > 0) {
    const inline = inlines[0]!.value as {start: TimeCandidate; end: TimeCandidate};
    eat(inlines[0]!);
    const dateKey = cleanDates[0] ? (cleanDates[0].value as {key: string}).key : baseKey;
    if (cleanDates[0]) {
      eat(cleanDates[0]);
    }
    // "2 to 3pm": the bare start hour inherits the end's half of the day.
    let startHour = inline.start.hour;
    if (!inline.start.explicit && startHour < 12 && inline.end.hour >= 12 && startHour + 12 <= inline.end.hour) {
      startHour += 12;
    }
    start = atDateKey(dateKey, startHour, inline.start.minute, ctx.timeZone);
    end = atDateKey(dateKey, inline.end.hour, inline.end.minute, ctx.timeZone);
    if (end <= start) {
      end += 86_400_000;
    }
    hasDate = true;
    hasTime = true;
  } else if (
    durationMinutes !== null &&
    cleanDates.length === 0 &&
    times.length === 0 &&
    offsets.length === 0
  ) {
    // A bare duration ("a 25 minute timer") means "starting now".
    start = ctx.now;
    end = ctx.now + durationMinutes * 60_000;
    hasTime = false;
  } else {
    // Date part
    let dateKey = baseKey;
    // "every monday at 10" anchors the first occurrence to that weekday.
    if (cleanDates.length === 0 && recurrence) {
      const byDay = /BYDAY=([A-Z,]+)/.exec(recurrence)?.[1];
      if (byDay) {
        const codes = byDay.split(',');
        const targets = codes
          .map(code => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(code))
          .filter(day => day >= 0);
        if (targets.length > 0) {
          let best: string | null = null;
          for (const target of targets) {
            const candidate = nextWeekdayKey(baseKey, target, true);
            if (best === null || candidate < best) {
              best = candidate;
            }
          }
          if (best) {
            dateKey = best;
            hasDate = true;
          }
        }
      }
    }
    if (cleanDates.length > 0) {
      const chosen = cleanDates[0]!.value as {key: string; night?: boolean};
      dateKey = chosen.key;
      eat(cleanDates[0]!);
      hasDate = true;
      if (cleanDates.length > 1) {
        confidence = 0.6;
        notes.push('I found more than one date; using the first one.');
      }
    }

    // Time part
    let clock: TimeCandidate | null = null;
    if (times.length > 0) {
      clock = times[0]!.value as TimeCandidate;
      eat(times[0]!);
      hasTime = true;
      if (times.length > 1) {
        confidence = Math.min(confidence, 0.65);
        notes.push('I found more than one time; using the first one.');
      }
    } else if (cleanDates[0] && (cleanDates[0].value as {night?: boolean}).night) {
      clock = {hour: 19, minute: 0, explicit: false};
      hasTime = true;
      if (dates.length > 1) {
        confidence = Math.min(confidence, 0.7);
      }
    }

    if (!clock) {
      if (durationMinutes !== null) {
        // "review for 45 minutes tomorrow" is a timed block, not an all-day one.
        start = atDateKey(dateKey, ctx.defaultHour ?? 9, 0, ctx.timeZone);
        end = start + durationMinutes * 60_000;
        hasTime = true;
        allDay = false;
      } else {
        // A date without a clock time is an all-day span for events; the planner
        // turns it into a date-only due date for tasks.
        allDay = true;
        start = atDateKey(dateKey, 0, 0, ctx.timeZone);
        end = atDateKey(addDaysToDateKey(dateKey, 1), 0, 0, ctx.timeZone);
        if (!hasDate) {
          confidence = 0.3;
        }
      }
    } else {
      if (!clock.explicit) {
        if (dateKey !== baseKey) {
          // On a future date "at 3" means the afternoon slot.
          const hour = clock.hour < 12 ? clock.hour + 12 : clock.hour;
          start = atDateKey(dateKey, hour, clock.minute, ctx.timeZone);
        } else {
          // Same day: choose the next 3am/3pm occurrence.
          const am = atDateKey(dateKey, clock.hour % 12, clock.minute, ctx.timeZone);
          const pm = atDateKey(dateKey, (clock.hour % 12) + 12, clock.minute, ctx.timeZone);
          const options = [am, pm].sort((a, b) => a - b);
          start = options.find(value => value > ctx.now) ?? pm;
        }
      } else {
        start = atDateKey(dateKey, clock.hour, clock.minute, ctx.timeZone);
      }
      if (!hasDate && start <= ctx.now) {
        // "at 9" said in the evening means tomorrow morning.
        start = atDateKey(addDaysToDateKey(dateKey, 1), zonedParts(start, ctx.timeZone).hour, zonedParts(start, ctx.timeZone).minute, ctx.timeZone);
        confidence = Math.min(confidence, 0.8);
        notes.push('That time already passed today, so I used tomorrow.');
      }
      const minutes = durationMinutes ?? ctx.defaultEventMinutes;
      end = start + minutes * 60_000;
      allDay = false;
    }
  }

  // A duration with no date/time was already resolved to now + duration above;
  // every other path derives `end` from the start.


  if (allDay && recurrence) {
    // All-day recurring events keep a one-day span.
    end = start + 86_400_000;
  }

  return {
    start,
    end,
    allDay,
    hasDate,
    hasTime,
    recurrence,
    consumed,
    confidence,
    notes,
  };
}

/** Removes consumed spans and command filler, leaving a usable title. */
export function stripTemporal(text: string, consumed: readonly [number, number][]): string {
  const chars = [...text];
  for (const [start, end] of consumed) {
    for (let i = start; i < end && i < chars.length; i += 1) {
      chars[i] = ' ';
    }
  }
  let remainder = chars.join('');
  // Only time-linked prepositions are dropped; ordinary words stay in titles.
  remainder = remainder
    .replace(/\b(at|on|by|around|starting|ending)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  remainder = remainder.replace(/^[\s,.;:—–-]+|[\s,.;:—–-]+$/g, '');
  return remainder.replace(/^(?:to|for|in|from)\s+/i, '').trim();
}
