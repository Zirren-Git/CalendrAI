import {addDaysToDateKey, dateKeyRange, daysBetweenDateKeys, weekdayOfDateKey} from './time';

export interface HabitProgress {
  streak: number;
  bestStreak: number;
  completedThisWeek: number;
  targetPerWeek: number;
  score: number;
  history: {date: string; done: boolean}[];
}

/**
 * Streaks count consecutive *scheduled* days that were completed, so a habit
 * scheduled on weekdays is not broken by the weekend. Today counts as "in
 * progress" rather than broken when it is scheduled but not yet checked off.
 */
export function computeHabitProgress(
  schedule: readonly number[],
  targetPerWeek: number,
  loggedDates: readonly string[],
  todayKey: string,
  lookbackDays = 90,
): HabitProgress {
  const logged = new Set(loggedDates);
  const scheduled = new Set(schedule.length > 0 ? schedule : [0, 1, 2, 3, 4, 5, 6]);
  const startKey = addDaysToDateKey(todayKey, -lookbackDays);
  const keys = dateKeyRange(startKey, todayKey);

  let best = 0;
  let running = 0;
  for (const key of keys) {
    if (!scheduled.has(weekdayOfDateKey(key))) {
      continue;
    }
    if (logged.has(key)) {
      running += 1;
      best = Math.max(best, running);
    } else {
      running = 0;
    }
  }

  let cursor = todayKey;
  if (scheduled.has(weekdayOfDateKey(todayKey)) && !logged.has(todayKey)) {
    cursor = addDaysToDateKey(todayKey, -1);
  }
  let current = 0;
  while (daysBetweenDateKeys(startKey, cursor) >= 0) {
    if (scheduled.has(weekdayOfDateKey(cursor))) {
      if (logged.has(cursor)) {
        current += 1;
      } else {
        break;
      }
    }
    cursor = addDaysToDateKey(cursor, -1);
  }

  const weekStartKey = addDaysToDateKey(todayKey, -((weekdayOfDateKey(todayKey) + 6) % 7));
  const weekKeys = dateKeyRange(weekStartKey, addDaysToDateKey(weekStartKey, 6));
  const completedThisWeek = weekKeys.filter(key => logged.has(key)).length;
  const score = targetPerWeek === 0 ? 0 : Math.min(1, completedThisWeek / targetPerWeek);

  return {
    streak: current,
    bestStreak: Math.max(best, current),
    completedThisWeek,
    targetPerWeek,
    score,
    history: keys.slice(-14).map(key => ({date: key, done: logged.has(key)})),
  };
}

/** Fraction of habits scheduled today that are checked off. */
export function dailyHabitScore(
  habitIdsToday: readonly string[],
  loggedHabitIdsToday: ReadonlySet<string>,
): number {
  if (habitIdsToday.length === 0) {
    return 0;
  }
  const done = habitIdsToday.filter(id => loggedHabitIdsToday.has(id)).length;
  return done / habitIdsToday.length;
}

/** Mean of each habit's weekly completion ratio against its own target. */
export function weeklyHabitScore(
  habits: readonly {id: string; targetPerWeek: number}[],
  loggedByHabit: ReadonlyMap<string, readonly string[]>,
  todayKey: string,
): number {
  if (habits.length === 0) {
    return 0;
  }
  const weekStartKey = addDaysToDateKey(todayKey, -((weekdayOfDateKey(todayKey) + 6) % 7));
  const weekKeys = new Set(dateKeyRange(weekStartKey, addDaysToDateKey(weekStartKey, 6)));
  const scores = habits.map(habit => {
    const logged = loggedByHabit.get(habit.id) ?? [];
    const count = logged.filter(date => weekKeys.has(date)).length;
    return habit.targetPerWeek === 0 ? 0 : Math.min(1, count / habit.targetPerWeek);
  });
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}
