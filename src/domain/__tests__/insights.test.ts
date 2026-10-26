import {calendarLoad, productivityScore, weeklySummary} from '../insights';
import type {Occurrence} from '../types';
import {wallClockToUtc} from '../time';

const TZ = 'America/New_York';

function occ(hour: number, minutes: number): Occurrence {
  const start = wallClockToUtc({year: 2026, month: 5, day: 4, hour, minute: 0}, TZ);
  return {
    eventId: 'e',
    title: 'Meeting',
    start,
    end: start + minutes * 60_000,
    allDay: false,
    color: '#000',
    location: null,
    notes: null,
    timezone: TZ,
    occurrenceStart: start,
    recurring: false,
    isOverride: false,
  };
}

describe('calendarLoad', () => {
  it('measures booked working hours and the largest gap', () => {
    const anchor = wallClockToUtc({year: 2026, month: 5, day: 4, hour: 12, minute: 0}, TZ);
    const load = calendarLoad([occ(9, 60), occ(11, 120)], anchor, TZ, 9 * 60, 18 * 60);
    expect(load.scheduledMinutes).toBe(180);
    expect(load.availableMinutes).toBe(540);
    expect(load.meetingCount).toBe(2);
    expect(load.longestFreeBlockMinutes).toBe(300); // 13:00 to 18:00
    expect(load.ratio).toBeCloseTo(1 / 3, 2);
    expect(load.busiestHour).not.toBeNull();
  });

  it('ignores all-day events when computing load', () => {
    const anchor = wallClockToUtc({year: 2026, month: 5, day: 4, hour: 12, minute: 0}, TZ);
    const allDay: Occurrence = {...occ(0, 0), allDay: true, end: occ(0, 0).start + 86_400_000};
    const load = calendarLoad([allDay], anchor, TZ, 9 * 60, 18 * 60);
    expect(load.scheduledMinutes).toBe(0);
  });
});

describe('productivityScore', () => {
  it('is bounded and rewards completion, focus and habits', () => {
    const best = productivityScore({
      tasksCompleted: 4,
      tasksPlanned: 4,
      focusMinutes: 120,
      focusGoalMinutes: 120,
      habitScore: 1,
      scheduledMinutes: 300,
      availableMinutes: 540,
    });
    expect(best.score).toBeGreaterThanOrEqual(90);
    const empty = productivityScore({
      tasksCompleted: 0,
      tasksPlanned: 0,
      focusMinutes: 0,
      focusGoalMinutes: 120,
      habitScore: 0,
      scheduledMinutes: 0,
      availableMinutes: 540,
    });
    expect(empty.score).toBeLessThan(40);
    expect(empty.score).toBeGreaterThanOrEqual(0);
  });

  it('penalises a fully booked calendar on balance', () => {
    const packed = productivityScore({
      tasksCompleted: 4,
      tasksPlanned: 4,
      focusMinutes: 120,
      focusGoalMinutes: 120,
      habitScore: 1,
      scheduledMinutes: 540,
      availableMinutes: 540,
    });
    expect(packed.score).toBeLessThan(100);
    expect(packed.note).toMatch(/packed/);
  });
});

describe('weeklySummary', () => {
  it('aggregates the week', () => {
    const summary = weeklySummary({
      completionsByDay: [1, 0, 3],
      focusMinutesByDay: [25, 50, 0],
      habitCompletions: 5,
      habitTargets: 7,
      scheduledMinutesByDay: [60, 120, 240],
    });
    expect(summary.tasksCompleted).toBe(4);
    expect(summary.focusMinutes).toBe(75);
    expect(summary.habitRate).toBeCloseTo(5 / 7, 3);
    expect(summary.busiestDay).toBe(2);
    expect(summary.averageScheduledMinutes).toBe(140);
  });
});
