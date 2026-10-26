import {parseClock, resolveTemporal, stripTemporal} from '../datetime';
import {localDateKey, wallClockToUtc} from '../../domain/time';

const TZ = 'America/New_York';

function ctx(nowYmd: [number, number, number], hour = 9, minute = 0) {
  return {
    now: wallClockToUtc(
      {year: nowYmd[0], month: nowYmd[1], day: nowYmd[2], hour, minute},
      TZ,
    ),
    timeZone: TZ,
    defaultEventMinutes: 60,
  };
}

describe('parseClock', () => {
  it('handles explicit and 24h times', () => {
    expect(parseClock('9am')).toEqual({hour: 9, minute: 0, explicit: true});
    expect(parseClock('9 pm')).toEqual({hour: 21, minute: 0, explicit: true});
    expect(parseClock('12am')).toEqual({hour: 0, minute: 0, explicit: true});
    expect(parseClock('12pm')).toEqual({hour: 12, minute: 0, explicit: true});
    expect(parseClock('15:30')).toEqual({hour: 15, minute: 30, explicit: false});
    expect(parseClock('25:00')).toBeNull();
  });
});

describe('resolveTemporal', () => {
  it('resolves "tomorrow at 9am"', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('add standup tomorrow at 9am', c);
    expect(localDateKey(result.start, TZ)).toBe('2026-05-05');
    expect(result.start).toBe(wallClockToUtc({year: 2026, month: 5, day: 5, hour: 9, minute: 0}, TZ));
    expect(result.end - result.start).toBe(60 * 60_000);
    expect(result.hasTime).toBe(true);
    expect(result.allDay).toBe(false);
  });

  it('resolves "lunch at noon on friday"', () => {
    const c = ctx([2026, 5, 4]); // Monday
    const result = resolveTemporal('lunch at noon on friday', c);
    expect(localDateKey(result.start, TZ)).toBe('2026-05-08');
    expect(result.start).toBe(wallClockToUtc({year: 2026, month: 5, day: 8, hour: 12, minute: 0}, TZ));
  });

  it('resolves relative offsets', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('call mom in 20 minutes', c);
    expect(result.start).toBe(c.now + 20 * 60_000);
    expect(result.end - result.start).toBe(60 * 60_000);
  });

  it('resolves "tonight" to the evening', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('call mom tonight', c);
    expect(localDateKey(result.start, TZ)).toBe('2026-05-04');
    expect(result.start).toBe(wallClockToUtc({year: 2026, month: 5, day: 4, hour: 19, minute: 0}, TZ));
  });

  it('rolls a past month/day into next year', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('review on march 3 at 2pm', c);
    expect(localDateKey(result.start, TZ)).toBe('2027-03-03');
    expect(result.start).toBe(wallClockToUtc({year: 2027, month: 3, day: 3, hour: 14, minute: 0}, TZ));
  });

  it('anchors "every monday" to Monday and builds a rule', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('standup every monday at 10', c);
    expect(result.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(localDateKey(result.start, TZ)).toBe('2026-05-04');
    expect(result.start).toBe(wallClockToUtc({year: 2026, month: 5, day: 4, hour: 10, minute: 0}, TZ));
  });

  it('aligns a bare range start with the end meridiem', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('meeting from 2 to 3pm', c);
    expect(result.start).toBe(wallClockToUtc({year: 2026, month: 5, day: 4, hour: 14, minute: 0}, TZ));
    expect(result.end).toBe(wallClockToUtc({year: 2026, month: 5, day: 4, hour: 15, minute: 0}, TZ));
  });

  it('prefers the afternoon for an ambiguous time on a future date', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('dentist on the 12th at 3', c);
    expect(localDateKey(result.start, TZ)).toBe('2026-05-12');
    expect(result.start).toBe(wallClockToUtc({year: 2026, month: 5, day: 12, hour: 15, minute: 0}, TZ));
  });

  it('uses the afternoon for a same-day ambiguous time that has passed', () => {
    const c = ctx([2026, 5, 4], 10, 0);
    const result = resolveTemporal('coffee at 3', c);
    expect(result.start).toBe(wallClockToUtc({year: 2026, month: 5, day: 4, hour: 15, minute: 0}, TZ));
  });

  it('keeps the local hour across a DST transition', () => {
    const c = ctx([2026, 3, 7], 20, 0); // evening before spring forward
    const result = resolveTemporal('standup tomorrow at 9am', c);
    expect(result.start).toBe(Date.UTC(2026, 2, 8, 13, 0));
  });

  it('parses durations', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('review for 45 minutes tomorrow', c);
    expect(result.end - result.start).toBe(45 * 60_000);
  });

  it('treats a bare duration as starting now', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('start a 25 minute timer', c);
    expect(result.start).toBe(c.now);
    expect(result.end - result.start).toBe(25 * 60_000);
  });

  it('marks a date-only phrase as all-day', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('conference tomorrow', c);
    expect(result.allDay).toBe(true);
    expect(result.hasTime).toBe(false);
    expect(localDateKey(result.start, TZ)).toBe('2026-05-05');
    expect(result.end - result.start).toBe(86_400_000);
  });

  it('flags multiple dates as ambiguous', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('meeting tomorrow and friday', c);
    expect(result.notes.join(' ')).toMatch(/more than one date/i);
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('reports low confidence when there is no temporal information', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('buy milk', c);
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });
});

describe('stripTemporal', () => {
  it('removes temporal phrases and keeps the title words', () => {
    const c = ctx([2026, 5, 4]);
    const result = resolveTemporal('add standup tomorrow at 9am', c);
    expect(stripTemporal('add standup tomorrow at 9am', result.consumed)).toBe('add standup');
  });

  it('does not remove prepositions that belong to the title', () => {
    const c = ctx([2026, 5, 4]);
    const text = 'meeting with the design team tomorrow';
    const result = resolveTemporal(text, c);
    expect(stripTemporal(text, result.consumed)).toBe('meeting with the design team');
  });
});
