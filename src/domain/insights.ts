import type {Occurrence} from './types';
import {findFreeSlots} from './events';
import {localDateKey} from './time';

export interface CalendarLoad {
  scheduledMinutes: number;
  availableMinutes: number;
  ratio: number;
  meetingCount: number;
  longestFreeBlockMinutes: number;
  busiestHour: number | null;
}

/** Ratio of working hours already booked, plus the largest remaining gap. */
export function calendarLoad(
  occurrences: readonly Occurrence[],
  dayAnchor: number,
  timeZone: string,
  workdayStart: number,
  workdayEnd: number,
): CalendarLoad {
  const dayKey = localDateKey(dayAnchor, timeZone);
  const todays = occurrences.filter(o => !o.allDay && localDateKey(o.start, timeZone) === dayKey);
  const availableMinutes = Math.max(0, workdayEnd - workdayStart);
  const scheduledMinutes = todays.reduce(
    (sum, o) => sum + Math.max(0, (o.end - o.start) / 60_000),
    0,
  );
  const slots = findFreeSlots(todays, dayAnchor, timeZone, {
    workdayStart,
    workdayEnd,
    minMinutes: 5,
  });
  const longestFreeBlockMinutes = slots.reduce((max, slot) => Math.max(max, slot.minutes), 0);
  const hourBuckets = new Map<number, number>();
  for (const occurrence of todays) {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {timeZone, hour: 'numeric', hour12: false}).format(
        new Date(occurrence.start),
      ),
    );
    hourBuckets.set(hour % 24, (hourBuckets.get(hour % 24) ?? 0) + (occurrence.end - occurrence.start) / 60_000);
  }
  let busiestHour: number | null = null;
  let busiest = -1;
  for (const [hour, minutes] of hourBuckets) {
    if (minutes > busiest) {
      busiest = minutes;
      busiestHour = hour;
    }
  }
  return {
    scheduledMinutes: Math.round(scheduledMinutes),
    availableMinutes,
    ratio: availableMinutes === 0 ? 0 : Math.min(2, scheduledMinutes / availableMinutes),
    meetingCount: todays.length,
    longestFreeBlockMinutes,
    busiestHour,
  };
}

export interface ProductivityInput {
  tasksCompleted: number;
  tasksPlanned: number;
  focusMinutes: number;
  focusGoalMinutes: number;
  habitScore: number; // 0..1
  scheduledMinutes: number;
  availableMinutes: number;
}

export interface ProductivityResult {
  score: number; // 0..100
  parts: {label: string; value: number; weight: number}[];
  note: string;
}

/**
 * A transparent 0-100 score. Weights: task completion 40, focus time 30,
 * habits 20, and calendar balance 10 (a day that is 100% booked scores lowest
 * on balance because nothing else can happen).
 */
export function productivityScore(input: ProductivityInput): ProductivityResult {
  const taskRatio = input.tasksPlanned === 0 ? 0.5 : Math.min(1, input.tasksCompleted / input.tasksPlanned);
  const focusRatio = input.focusGoalMinutes === 0 ? 0 : Math.min(1, input.focusMinutes / input.focusGoalMinutes);
  const habitRatio = Math.max(0, Math.min(1, input.habitScore));
  const loadRatio =
    input.availableMinutes === 0 ? 0 : Math.min(1, input.scheduledMinutes / input.availableMinutes);
  // Balanced is ideal: 50-75% booked. Empty days and 100% booked days both lose.
  const balance = 1 - Math.abs(loadRatio - 0.6) / 0.6;
  const parts = [
    {label: 'Tasks', value: Math.round(taskRatio * 40), weight: 40},
    {label: 'Focus', value: Math.round(focusRatio * 30), weight: 30},
    {label: 'Habits', value: Math.round(habitRatio * 20), weight: 20},
    {label: 'Balance', value: Math.round(Math.max(0, balance) * 10), weight: 10},
  ];
  const score = Math.max(0, Math.min(100, parts.reduce((sum, part) => sum + part.value, 0)));
  const note =
    loadRatio > 0.9
      ? 'Your calendar is packed — consider protecting a focus block.'
      : score >= 75
        ? 'Strong day. Keep the rhythm.'
        : score >= 45
          ? 'Steady progress. One more focus block would help.'
          : 'Light day so far — pick one meaningful task.';
  return {score, parts, note};
}

export interface WeeklySummaryInput {
  completionsByDay: number[];
  focusMinutesByDay: number[];
  habitCompletions: number;
  habitTargets: number;
  scheduledMinutesByDay: number[];
}

export interface WeeklySummary {
  tasksCompleted: number;
  focusMinutes: number;
  habitRate: number;
  busiestDay: number;
  averageScheduledMinutes: number;
}

export function weeklySummary(input: WeeklySummaryInput): WeeklySummary {
  const tasksCompleted = input.completionsByDay.reduce((a, b) => a + b, 0);
  const focusMinutes = input.focusMinutesByDay.reduce((a, b) => a + b, 0);
  const habitRate = input.habitTargets === 0 ? 0 : Math.min(1, input.habitCompletions / input.habitTargets);
  let busiestDay = 0;
  let busiest = -1;
  input.scheduledMinutesByDay.forEach((minutes, index) => {
    if (minutes > busiest) {
      busiest = minutes;
      busiestDay = index;
    }
  });
  const averageScheduledMinutes =
    input.scheduledMinutesByDay.length === 0
      ? 0
      : Math.round(
          input.scheduledMinutesByDay.reduce((a, b) => a + b, 0) / input.scheduledMinutesByDay.length,
        );
  return {tasksCompleted, focusMinutes, habitRate, busiestDay, averageScheduledMinutes};
}
