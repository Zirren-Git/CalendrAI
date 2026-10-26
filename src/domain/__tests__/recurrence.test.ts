import {
  buildRRule,
  candidateDateKeys,
  expandEvent,
  occursOnLocalDate,
  parseRRule,
  RRuleError,
} from '../recurrence';
import {localDateKey, wallClockToUtc} from '../time';
import type {CalendarEvent, EventException} from '../types';

const NY = 'America/New_York';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const start = overrides.start ?? Date.UTC(2026, 4, 4, 13, 0); // Mon 2026-05-04 09:00 EDT
  return {
    id: 'evt-1',
    title: 'Standup',
    location: null,
    notes: null,
    start,
    end: start + 30 * 60_000,
    allDay: false,
    timezone: NY,
    color: '#C25E3A',
    attendees: [],
    rrule: null,
    exceptionParentId: null,
    occurrenceOriginalStart: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('parseRRule', () => {
  it('parses supported parts', () => {
    const rule = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10');
    expect(rule).toMatchObject({freq: 'WEEKLY', interval: 2, byDay: [1, 3], count: 10});
  });

  it('rejects unknown parts instead of ignoring them', () => {
    expect(() => parseRRule('FREQ=DAILY;BYHOUR=9')).toThrow(RRuleError);
  });

  it('rejects missing FREQ', () => {
    expect(() => parseRRule('INTERVAL=2')).toThrow(RRuleError);
  });

  it('round trips through buildRRule', () => {
    const rule = parseRRule('FREQ=MONTHLY;BYMONTHDAY=1,15');
    expect(buildRRule(rule!)).toBe('FREQ=MONTHLY;BYMONTHDAY=1,15');
  });
});

describe('expandEvent', () => {
  const range = {rangeStart: Date.UTC(2026, 4, 1), rangeEnd: Date.UTC(2026, 5, 1)};

  it('returns a single occurrence for a non-recurring event in range', () => {
    const occurrences = expandEvent(event(), range);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.start).toBe(Date.UTC(2026, 4, 4, 13, 0));
  });

  it('omits non-recurring events outside the range', () => {
    expect(expandEvent(event(), {rangeStart: Date.UTC(2026, 5, 1), rangeEnd: Date.UTC(2026, 6, 1)})).toHaveLength(0);
  });

  it('expands weekly BYDAY rules on the correct weekdays', () => {
    const occurrences = expandEvent(event({rrule: 'FREQ=WEEKLY;BYDAY=MO,WE'}), {
      rangeStart: Date.UTC(2026, 4, 4),
      rangeEnd: Date.UTC(2026, 4, 10),
    });
    expect(occurrences.map(o => localDateKey(o.start, NY))).toEqual([
      '2026-05-04',
      '2026-05-06',
    ]);
  });

  it('respects COUNT', () => {
    const occurrences = expandEvent(event({rrule: 'FREQ=DAILY;COUNT=3'}), {
      rangeStart: Date.UTC(2026, 4, 4),
      rangeEnd: Date.UTC(2026, 4, 20),
    });
    expect(occurrences.map(o => localDateKey(o.start, NY))).toEqual([
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
    ]);
  });

  it('respects UNTIL', () => {
    const occurrences = expandEvent(
      event({rrule: 'FREQ=DAILY;UNTIL=20260506T235959Z'}),
      {rangeStart: Date.UTC(2026, 4, 4), rangeEnd: Date.UTC(2026, 4, 20)},
    );
    expect(occurrences).toHaveLength(3);
  });

  it('skips months without the requested day', () => {
    const jan31 = event({
      start: wallClockToUtc({year: 2026, month: 1, day: 31, hour: 9, minute: 0}, NY),
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=31',
    });
    const occurrences = expandEvent(jan31, {
      rangeStart: Date.UTC(2026, 0, 1),
      rangeEnd: Date.UTC(2026, 3, 30),
    });
    expect(occurrences.map(o => localDateKey(o.start, NY))).toEqual([
      '2026-01-31',
      '2026-03-31',
    ]);
  });

  it('keeps the local wall-clock hour across a DST transition', () => {
    const series = event({
      start: wallClockToUtc({year: 2026, month: 3, day: 2, hour: 9, minute: 0}, NY),
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const occurrences = expandEvent(series, {
      rangeStart: Date.UTC(2026, 2, 1),
      rangeEnd: Date.UTC(2026, 2, 16),
    });
    const localHours = occurrences.map(o => {
      const key = localDateKey(o.start, NY);
      return {key, utcHour: new Date(o.start).getUTCHours()};
    });
    expect(localHours).toEqual([
      {key: '2026-03-02', utcHour: 14}, // EST (UTC-5)
      {key: '2026-03-09', utcHour: 13}, // EDT (UTC-4)
    ]);
  });

  it('drops cancelled instances', () => {
    const series = event({rrule: 'FREQ=DAILY;COUNT=4'});
    const second = Date.UTC(2026, 4, 5, 13, 0);
    const exceptions: EventException[] = [
      {id: 'x1', eventId: series.id, occurrenceStart: second, cancelled: true, overrideEventId: null},
    ];
    const occurrences = expandEvent(series, {
      rangeStart: Date.UTC(2026, 4, 4),
      rangeEnd: Date.UTC(2026, 4, 10),
      exceptions,
    });
    expect(occurrences.map(o => localDateKey(o.start, NY))).toEqual([
      '2026-05-04',
      '2026-05-06',
      '2026-05-07',
    ]);
  });

  it('replaces an instance with its modified override', () => {
    const series = event({rrule: 'FREQ=DAILY;COUNT=3'});
    const second = Date.UTC(2026, 4, 5, 13, 0);
    const override = event({
      id: 'evt-1-override',
      title: 'Standup (moved)',
      start: second + 2 * 3600_000,
      end: second + 2 * 3600_000 + 30 * 60_000,
      exceptionParentId: series.id,
      occurrenceOriginalStart: second,
    });
    const exceptions: EventException[] = [
      {id: 'x2', eventId: series.id, occurrenceStart: second, cancelled: false, overrideEventId: override.id},
    ];
    const occurrences = expandEvent(series, {
      rangeStart: Date.UTC(2026, 4, 4),
      rangeEnd: Date.UTC(2026, 4, 10),
      exceptions,
      overrides: [override],
    });
    expect(occurrences).toHaveLength(3);
    expect(occurrences[1]!.title).toBe('Standup (moved)');
    expect(occurrences[1]!.isOverride).toBe(true);
  });

  it('caps runaway expansions', () => {
    const occurrences = expandEvent(event({rrule: 'FREQ=DAILY'}), {
      rangeStart: Date.UTC(1990, 0, 1),
      rangeEnd: Date.UTC(2035, 0, 1),
      limit: 50,
    });
    expect(occurrences.length).toBeLessThanOrEqual(50);
  });

  it('handles all-day series without time drift', () => {
    const allDay = event({
      start: wallClockToUtc({year: 2026, month: 3, day: 7, hour: 0, minute: 0}, NY),
      end: wallClockToUtc({year: 2026, month: 3, day: 8, hour: 0, minute: 0}, NY),
      allDay: true,
      rrule: 'FREQ=DAILY;COUNT=3',
    });
    const occurrences = expandEvent(allDay, {
      rangeStart: Date.UTC(2026, 2, 1),
      rangeEnd: Date.UTC(2026, 2, 15),
    });
    expect(occurrences.map(o => localDateKey(o.start, NY))).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
  });
});

describe('candidateDateKeys', () => {
  it('starts on the series date for weekly rules', () => {
    const rule = parseRRule('FREQ=WEEKLY;BYDAY=MO,FR')!;
    const keys = Array.from(candidateDateKeys('2026-05-06', rule, 4));
    expect(keys[0]).toBe('2026-05-08');
    expect(keys[1]).toBe('2026-05-11');
  });
});

describe('occursOnLocalDate', () => {
  it('detects a recurring instance on a local date', () => {
    const series = event({rrule: 'FREQ=WEEKLY;BYDAY=MO'});
    expect(occursOnLocalDate(series, '2026-05-11')).toBe(true);
    expect(occursOnLocalDate(series, '2026-05-12')).toBe(false);
  });
});
