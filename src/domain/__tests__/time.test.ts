import {
  addDaysToDateKey,
  dateKeyRange,
  endOfLocalDay,
  formatTime,
  localDateKey,
  localDayRange,
  startOfLocalDay,
  startOfLocalWeek,
  wallClockToUtc,
  zonedParts,
} from '../time';

const NY = 'America/New_York';

describe('wallClockToUtc', () => {
  it('converts UTC wall time unchanged', () => {
    expect(wallClockToUtc({year: 2026, month: 5, day: 1, hour: 9, minute: 0}, 'UTC')).toBe(
      Date.UTC(2026, 4, 1, 9, 0),
    );
  });

  it('applies standard and daylight offsets', () => {
    expect(wallClockToUtc({year: 2026, month: 1, day: 15, hour: 9, minute: 0}, NY)).toBe(
      Date.UTC(2026, 0, 15, 14, 0),
    );
    expect(wallClockToUtc({year: 2026, month: 7, day: 15, hour: 9, minute: 0}, NY)).toBe(
      Date.UTC(2026, 6, 15, 13, 0),
    );
  });

  it('shifts non-existent spring-forward times forward', () => {
    // 02:30 does not exist on 2026-03-08 in New York; it must become 03:30 EDT.
    const result = wallClockToUtc({year: 2026, month: 3, day: 8, hour: 2, minute: 30}, NY);
    const parts = zonedParts(result, NY);
    expect(parts.hour).toBe(3);
    expect(parts.minute).toBe(30);
    expect(result).toBe(Date.UTC(2026, 2, 8, 7, 30));
  });

  it('chooses the earlier instant for ambiguous fall-back times', () => {
    // 01:30 happens twice on 2026-11-01; the first (EDT) instance wins.
    const result = wallClockToUtc({year: 2026, month: 11, day: 1, hour: 1, minute: 30}, NY);
    expect(result).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });

  it('handles zones without DST', () => {
    expect(wallClockToUtc({year: 2026, month: 7, day: 1, hour: 12, minute: 0}, 'Asia/Tokyo')).toBe(
      Date.UTC(2026, 6, 1, 3, 0),
    );
  });
});

describe('local day boundaries', () => {
  it('reports the local date across the UTC midnight boundary', () => {
    // 2026-01-01T04:59Z is still 2025-12-31 in New York.
    expect(localDateKey(Date.UTC(2026, 0, 1, 4, 59), NY)).toBe('2025-12-31');
  });

  it('has a 23 hour day on spring forward and 25 hour day on fall back', () => {
    const spring = localDayRange(Date.UTC(2026, 2, 8, 12, 0), NY);
    const fall = localDayRange(Date.UTC(2026, 10, 1, 12, 0), NY);
    expect((spring.end + 1 - spring.start) / 3600_000).toBe(23);
    expect((fall.end + 1 - fall.start) / 3600_000).toBe(25);
  });

  it('startOfLocalDay and endOfLocalDay round trip', () => {
    const instant = Date.UTC(2026, 4, 20, 18, 30);
    const start = startOfLocalDay(instant, NY);
    const end = endOfLocalDay(instant, NY);
    expect(zonedParts(start, NY).hour).toBe(0);
    expect(end).toBeGreaterThan(start);
    expect(localDateKey(end, NY)).toBe(localDateKey(instant, NY));
  });

  it('computes Monday-based week starts', () => {
    // 2026-05-21 is a Thursday.
    const start = startOfLocalWeek(Date.UTC(2026, 4, 21, 15, 0), NY, 1);
    expect(localDateKey(start, NY)).toBe('2026-05-18');
    const sundayStart = startOfLocalWeek(Date.UTC(2026, 4, 21, 15, 0), NY, 0);
    expect(localDateKey(sundayStart, NY)).toBe('2026-05-17');
  });
});

describe('date key arithmetic', () => {
  it('adds days without timezone drift', () => {
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToDateKey('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('builds inclusive ranges', () => {
    expect(dateKeyRange('2026-03-01', '2026-03-03')).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
    ]);
  });

  it('formats times in 12h and 24h', () => {
    const noon = Date.UTC(2026, 4, 20, 16, 5);
    expect(formatTime(noon, NY, false)).toBe('12:05 PM');
    expect(formatTime(noon, NY, true)).toBe('12:05');
    expect(formatTime(Date.UTC(2026, 4, 20, 4, 0), NY, false)).toBe('12:00 AM');
  });
});
