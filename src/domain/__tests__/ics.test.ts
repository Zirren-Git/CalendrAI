import {exportIcs, importIcs} from '../ics';
import type {CalendarEvent} from '../types';
import {localDateKey, wallClockToUtc} from '../time';

const TZ = 'America/New_York';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const start = wallClockToUtc({year: 2026, month: 5, day: 4, hour: 9, minute: 30}, TZ);
  return {
    id: 'evt-1',
    title: 'Standup',
    location: 'Room 2',
    notes: 'Line one\nLine two, with comma; and semicolon',
    start,
    end: start + 30 * 60_000,
    allDay: false,
    timezone: TZ,
    color: '#C25E3A',
    attendees: [],
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    exceptionParentId: null,
    occurrenceOriginalStart: null,
    createdAt: start,
    updatedAt: start,
    ...overrides,
  };
}

describe('exportIcs', () => {
  it('writes a well-formed calendar with CRLF endings', () => {
    const ics = exportIcs([event()]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
    expect(ics).not.toContain('\n\n');
  });

  it('escapes text and folds long lines', () => {
    const escaped = exportIcs([event()]);
    expect(escaped).toContain('DESCRIPTION:Line one\\nLine two\\, with comma\\; and semicolon');
    const folded = exportIcs([event({notes: 'a'.repeat(200)})]);
    for (const line of folded.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });

  it('exports all-day events with VALUE=DATE', () => {
    const start = wallClockToUtc({year: 2026, month: 5, day: 4, hour: 0, minute: 0}, TZ);
    const ics = exportIcs([
      event({start, end: start + 86_400_000, allDay: true, rrule: null}),
    ]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260504');
    expect(ics).toContain('DTEND;VALUE=DATE:20260505');
  });
});

describe('importIcs', () => {
  it('round trips an exported event', () => {
    const original = event();
    const ics = exportIcs([original]);
    expect(ics).toContain('BEGIN:VEVENT');
    const result = importIcs(ics, TZ);
    expect(result.warnings).toHaveLength(0);
    expect(result.events).toHaveLength(1);
    const imported = result.events[0]!;
    expect(imported.title).toBe(original.title);
    expect(imported.start).toBe(original.start);
    expect(imported.end).toBe(original.end);
    expect(imported.location).toBe(original.location);
    expect(imported.notes).toBe(original.notes);
    expect(imported.rrule).toBe(original.rrule);
  });

  it('parses TZID wall times', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;TZID=America/New_York:20260504T093000',
      'DTEND;TZID=America/New_York:20260504T100000',
      'SUMMARY:Review',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = importIcs(ics, 'UTC');
    expect(result.events[0]!.start).toBe(
      wallClockToUtc({year: 2026, month: 5, day: 4, hour: 9, minute: 30}, TZ),
    );
  });

  it('parses all-day dates and DURATION fallbacks', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260504',
      'SUMMARY:Conference',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20260504T130000Z',
      'DURATION:PT90M',
      'SUMMARY:Workshop',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const result = importIcs(ics, TZ);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]!.allDay).toBe(true);
    expect(result.events[1]!.end - result.events[1]!.start).toBe(90 * 60_000);
  });

  it('unfolds folded lines and unescapes text', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260504T130000Z',
      'SUMMARY:A very long title that has been fold',
      ' ed across two physical lines',
      'DESCRIPTION:First\\nSecond\\, third',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = importIcs(ics, TZ);
    expect(result.events[0]!.title).toBe(
      'A very long title that has been folded across two physical lines',
    );
    expect(result.events[0]!.notes).toBe('First\nSecond, third');
  });

  it('skips invalid events with warnings and keeps valid ones', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:No start',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:not-a-date',
      'SUMMARY:Bad date',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20260504T130000Z',
      'DTEND:20260504T120000Z',
      'SUMMARY:Backwards',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20260504T130000Z',
      'SUMMARY:Good',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = importIcs(ics, TZ);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.title).toBe('Good');
    expect(result.skipped).toBe(3);
    expect(result.warnings).toHaveLength(3);
  });

  it('handles an empty document without throwing', () => {
    const result = importIcs('', TZ);
    expect(result.events).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('keeps the local date of an exported all-day event', () => {
    const start = wallClockToUtc({year: 2026, month: 3, day: 8, hour: 0, minute: 0}, TZ);
    const ics = exportIcs([event({start, end: start + 86_400_000, allDay: true, rrule: null})]);
    const result = importIcs(ics, TZ);
    expect(localDateKey(result.events[0]!.start, TZ)).toBe('2026-03-08');
  });
});
