/** Derived data shared by the dashboard widgets. Pure functions over a snapshot. */
import type {Snapshot} from '../../state/store';
import type {
  Goal,
  Habit,
  HabitLog,
  Note,
  Occurrence,
  Settings,
  Task,
} from '../../domain/types';
import {
  addDaysToDateKey,
  dateKeyRange,
  localDateKey,
  weekdayOfDateKey,
} from '../../domain/time';
import {computeHabitProgress, dailyHabitScore, type HabitProgress} from '../../domain/habits';
import {calendarLoad, productivityScore, weeklySummary, type CalendarLoad} from '../../domain/insights';
import {findConflicts, findFreeSlots, type FreeSlot} from '../../domain/events';
import type {Conflict} from '../../domain/events';

export function tz(settings: Settings): string {
  return settings.calendarTimeZone;
}

export function occurrencesOn(snapshot: Snapshot, dateKey: string, settings: Settings): Occurrence[] {
  return snapshot.occurrences
    .filter(occurrence => localDateKey(occurrence.start, tz(settings)) === dateKey)
    .sort((a, b) => a.start - b.start);
}

export function todayOccurrences(snapshot: Snapshot, settings: Settings): Occurrence[] {
  return occurrencesOn(snapshot, snapshot.todayKey, settings);
}

export function timedToday(snapshot: Snapshot, settings: Settings): Occurrence[] {
  return todayOccurrences(snapshot, settings).filter(occurrence => !occurrence.allDay);
}

export function nextOccurrence(snapshot: Snapshot, settings: Settings): Occurrence | null {
  const now = snapshot.now;
  return (
    snapshot.occurrences
      .filter(occurrence => occurrence.end > now)
      .sort((a, b) => a.start - b.start)[0] ?? null
  );
}

export function openTasks(snapshot: Snapshot): Task[] {
  return snapshot.tasks.filter(task => !task.completedAt);
}

export function taskDayKey(task: Task, settings: Settings): string | null {
  return task.dueAt ? localDateKey(task.dueAt, tz(settings)) : null;
}

export function tasksDueOn(snapshot: Snapshot, dateKey: string, settings: Settings): Task[] {
  return openTasks(snapshot).filter(task => taskDayKey(task, settings) === dateKey);
}

export function tasksToday(snapshot: Snapshot, settings: Settings): Task[] {
  return tasksDueOn(snapshot, snapshot.todayKey, settings);
}

/** Open tasks whose due day is before today (local date, timezone-aware). */
export function overdueTasks(snapshot: Snapshot, settings: Settings): Task[] {
  return openTasks(snapshot).filter(task => {
    const key = taskDayKey(task, settings);
    return key !== null && key < snapshot.todayKey;
  });
}

export function upcomingTasks(snapshot: Snapshot, settings: Settings, days = 7): Task[] {
  const lastKey = addDaysToDateKey(snapshot.todayKey, days);
  return openTasks(snapshot).filter(task => {
    const key = taskDayKey(task, settings);
    return key !== null && key > snapshot.todayKey && key <= lastKey;
  });
}

export function completedToday(snapshot: Snapshot, settings: Settings): Task[] {
  return snapshot.tasks.filter(
    task => task.completedAt && localDateKey(task.completedAt, tz(settings)) === snapshot.todayKey,
  );
}

export function tasksForProject(snapshot: Snapshot, projectId: string): Task[] {
  return snapshot.tasks.filter(task => task.projectId === projectId);
}

export function habitIsScheduled(habit: Habit, dateKey: string): boolean {
  const schedule = habit.schedule.length > 0 ? habit.schedule : [0, 1, 2, 3, 4, 5, 6];
  return schedule.includes(weekdayOfDateKey(dateKey));
}

export function habitsToday(snapshot: Snapshot): Habit[] {
  return snapshot.habits
    .filter(habit => !habit.archived && habitIsScheduled(habit, snapshot.todayKey))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function habitLoggedOn(snapshot: Snapshot, habitId: string, dateKey: string): boolean {
  return snapshot.habitLogs.some(log => log.habitId === habitId && log.date === dateKey);
}

export function habitLogsFor(snapshot: Snapshot, habitId: string): HabitLog[] {
  return snapshot.habitLogs.filter(log => log.habitId === habitId);
}

export function habitProgress(snapshot: Snapshot, habit: Habit): HabitProgress {
  return computeHabitProgress(
    habit.schedule,
    habit.targetPerWeek,
    habitLogsFor(snapshot, habit.id).map(log => log.date),
    snapshot.todayKey,
  );
}

export function habitScoreToday(snapshot: Snapshot): number {
  const scheduled = habitsToday(snapshot).map(habit => habit.id);
  const logged = new Set(
    snapshot.habitLogs.filter(log => log.date === snapshot.todayKey).map(log => log.habitId),
  );
  return dailyHabitScore(scheduled, logged);
}

export function weekKeys(todayKey: string, weekStartsOn: 0 | 1): string[] {
  const weekday = weekdayOfDateKey(todayKey);
  const offset = (weekday - weekStartsOn + 7) % 7;
  const start = addDaysToDateKey(todayKey, -offset);
  return dateKeyRange(start, addDaysToDateKey(start, 6));
}

export function monthGridKeys(year: number, month: number, weekStartsOn: 0 | 1): string[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = first.getUTCDay();
  const lead = (firstWeekday - weekStartsOn + 7) % 7;
  const start = new Date(Date.UTC(year, month - 1, 1 - lead));
  return Array.from({length: 42}, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
      date.getUTCDate(),
    ).padStart(2, '0')}`;
  });
}

export function focusMinutesToday(snapshot: Snapshot): number {
  return snapshot.focusToday
    .filter(session => session.kind === 'focus' && session.endedAt)
    .reduce((sum, session) => sum + Math.max(0, ((session.endedAt ?? session.startedAt) - session.startedAt) / 60_000), 0);
}

export function focusSessionsToday(snapshot: Snapshot): number {
  return snapshot.focusToday.filter(session => session.kind === 'focus' && session.endedAt).length;
}

export function focusGoalMinutes(settings: Settings): number {
  return Math.max(25, settings.pomodoroMinutes * 4);
}

export function dayLoad(snapshot: Snapshot, settings: Settings, dateKey = snapshot.todayKey): CalendarLoad {
  const anchor = snapshot.occurrences.find(o => localDateKey(o.start, tz(settings)) === dateKey)?.start;
  const anchorMs = anchor ?? Date.now();
  return calendarLoad(
    snapshot.occurrences,
    anchorMs,
    tz(settings),
    settings.workdayStart,
    settings.workdayEnd,
  );
}

export function freeSlots(
  snapshot: Snapshot,
  settings: Settings,
  dateKey: string,
  minMinutes = 30,
): FreeSlot[] {
  const dayStart =
    snapshot.todayKey === dateKey
      ? snapshot.now
      : (snapshot.occurrences.find(o => localDateKey(o.start, tz(settings)) === dateKey)?.start ?? Date.now());
  return findFreeSlots(snapshot.occurrences, dayStart, tz(settings), {
    workdayStart: settings.workdayStart,
    workdayEnd: settings.workdayEnd,
    minMinutes,
  });
}

export function conflictsToday(snapshot: Snapshot, settings: Settings): Conflict[] {
  return findConflicts(timedToday(snapshot, settings));
}

export function productivity(snapshot: Snapshot, settings: Settings) {
  const load = dayLoad(snapshot, settings);
  return productivityScore({
    tasksCompleted: completedToday(snapshot, settings).length,
    tasksPlanned: tasksToday(snapshot, settings).length + completedToday(snapshot, settings).length,
    focusMinutes: Math.round(focusMinutesToday(snapshot)),
    focusGoalMinutes: focusGoalMinutes(settings),
    habitScore: habitScoreToday(snapshot),
    scheduledMinutes: load.scheduledMinutes,
    availableMinutes: load.availableMinutes,
  });
}

export function weekSummary(snapshot: Snapshot, settings: Settings) {
  const keys = weekKeys(snapshot.todayKey, settings.weekStartsOn);
  const completionsByDay = keys.map(
    key =>
      snapshot.tasks.filter(
        task => task.completedAt && localDateKey(task.completedAt, tz(settings)) === key,
      ).length,
  );
  const focusMinutesByDay = keys.map(key =>
    snapshot.recentSessions
      .filter(
        session =>
          session.kind === 'focus' &&
          session.endedAt &&
          localDateKey(session.startedAt, tz(settings)) === key,
      )
      .reduce(
        (sum, session) => sum + Math.max(0, ((session.endedAt ?? 0) - session.startedAt) / 60_000),
        0,
      ),
  );
  const scheduledMinutesByDay = keys.map(key =>
    snapshot.occurrences
      .filter(
        occurrence =>
          !occurrence.allDay &&
          localDateKey(occurrence.start, tz(settings)) === key,
      )
      .reduce((sum, occurrence) => sum + (occurrence.end - occurrence.start) / 60_000, 0),
  );
  const habitTargets = snapshot.habits
    .filter(habit => !habit.archived)
    .reduce((sum, habit) => sum + habit.targetPerWeek, 0);
  const habitCompletions = snapshot.habitLogs.filter(log => keys.includes(log.date)).length;
  return weeklySummary({
    completionsByDay,
    focusMinutesByDay,
    scheduledMinutesByDay,
    habitCompletions,
    habitTargets,
  });
}

export function pinnedNotes(snapshot: Snapshot): Note[] {
  return snapshot.notes.filter(note => note.pinned);
}

export function recentNotes(snapshot: Snapshot, limit = 5): Note[] {
  return [...snapshot.notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export function journalNote(snapshot: Snapshot): Note | null {
  return snapshot.notes.find(note => note.journalDate === snapshot.todayKey) ?? null;
}

export function activeGoals(snapshot: Snapshot): Goal[] {
  return snapshot.goals.filter(goal => goal.status === 'active');
}

export function projectCompletion(snapshot: Snapshot, projectId: string): {total: number; done: number} {
  return snapshot.projectStats[projectId] ?? {total: 0, done: 0};
}

export function taskProjectName(snapshot: Snapshot, task: Task): string | null {
  if (!task.projectId) {
    return null;
  }
  return snapshot.projects.find(project => project.id === task.projectId)?.name ?? null;
}

export function noteNotebookName(snapshot: Snapshot, note: Note): string | null {
  if (!note.notebookId) {
    return null;
  }
  return snapshot.notebooks.find(notebook => notebook.id === note.notebookId)?.name ?? null;
}

export function routineFor(snapshot: Snapshot, kind: 'morning' | 'evening') {
  const routine = snapshot.routines.find(entry => entry.kind === kind && entry.enabled);
  if (!routine) {
    return null;
  }
  const log = snapshot.routineLogs.find(entry => entry.routineId === routine.id);
  return {routine, completed: log?.completedItems ?? []};
}

/** Mean calendar load over the next `days` days, used by the load widget. */
export function averageLoad(snapshot: Snapshot, settings: Settings, days = 5): number {
  const keys = dateKeyRange(snapshot.todayKey, addDaysToDateKey(snapshot.todayKey, days - 1));
  const available = Math.max(1, settings.workdayEnd - settings.workdayStart);
  const scheduled = keys.map(key =>
    snapshot.occurrences
      .filter(
        occurrence =>
          !occurrence.allDay && localDateKey(occurrence.start, tz(settings)) === key,
      )
      .reduce((sum, occurrence) => sum + (occurrence.end - occurrence.start) / 60_000, 0),
  );
  return scheduled.reduce((sum, minutes) => sum + Math.min(1.5, minutes / available), 0) / keys.length;
}

