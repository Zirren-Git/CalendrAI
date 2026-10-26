/**
 * Executes a validated plan through the same repositories the UI uses. The
 * agent has no privileged path: every write is a repository call, so validation,
 * transactions and undo behave identically whether a change came from a tap or
 * from a spoken command.
 */
import type {SqlDriver} from '../db/driver';
import {formatDateKey, formatTime, localDateKey, zonedParts} from '../domain/time';
import {findFreeSlots} from '../domain/events';
import type {AgentAction, Plan} from './types';
import {validatePlan} from './types';
import {
  createEvent,
  deleteEvent,
  listOccurrences,
  overrideOccurrence,
  updateEvent,
} from '../repos/events';
import {
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  updateTask,
} from '../repos/tasks';
import {bucketTasks} from '../repos/tasks';
import {createNote} from '../repos/notes';
import {setHabitLog, getHabit} from '../repos/habits';
import {activeSession, endSession, startSession} from '../repos/focus';
import {createReminder} from '../repos/reminders';
import {createProject, findProjectByName} from '../repos/planning';
import {recordUndo} from '../repos/system';

export interface AgentDeps {
  db: SqlDriver;
  timeZone: string;
  clock24h: boolean;
  workdayStart: number;
  workdayEnd: number;
  now?: () => number;
  /** Called once after any successful write (widgets, launcher, reminders). */
  afterChange?: () => Promise<void> | void;
}

export interface ActionResult {
  actionId: string;
  type: AgentAction['type'];
  ok: boolean;
  message: string;
  answer?: string;
}

export interface ExecutionOutcome {
  planId: string;
  results: ActionResult[];
  succeeded: number;
  failed: number;
  allSucceeded: boolean;
  undoToken: string | null;
  navigateTo: string | null;
}

function labelFor(action: AgentAction): string {
  return action.type.replace(/_/g, ' ');
}

export async function executePlan(plan: Plan, deps: AgentDeps): Promise<ExecutionOutcome> {
  const now = deps.now ? deps.now() : Date.now();
  // Re-validate even though the planner already did: this is the trust boundary
  // for anything that came from a model.
  const validated = validatePlan(plan, now);
  const results: ActionResult[] = [];
  let undoToken: string | null = null;
  let changed = false;
  let navigateTo: string | null = null;

  for (const entry of validated.actions) {
    try {
      const outcome = await executeAction(entry.action, deps, now);
      results.push({
        actionId: entry.id,
        type: entry.action.type,
        ok: true,
        message: outcome.message,
        ...(outcome.answer ? {answer: outcome.answer} : {}),
      });
      if (outcome.changed) {
        changed = true;
      }
      if (outcome.undoToken) {
        undoToken = outcome.undoToken;
      }
      if (outcome.navigateTo) {
        navigateTo = outcome.navigateTo;
      }
    } catch (error) {
      results.push({
        actionId: entry.id,
        type: entry.action.type,
        ok: false,
        message: error instanceof Error ? error.message : `Could not ${labelFor(entry.action)}`,
      });
    }
  }

  if (changed && deps.afterChange) {
    try {
      await deps.afterChange();
    } catch {
      // A refresh failure must not turn a completed write into a failed action.
    }
  }

  const succeeded = results.filter(result => result.ok).length;
  return {
    planId: validated.id,
    results,
    succeeded,
    failed: results.length - succeeded,
    allSucceeded: succeeded === results.length,
    undoToken,
    navigateTo,
  };
}

interface ActionOutcome {
  message: string;
  answer?: string;
  changed?: boolean;
  undoToken?: string;
  navigateTo?: string;
}

async function executeAction(action: AgentAction, deps: AgentDeps, now: number): Promise<ActionOutcome> {
  const {db} = deps;
  switch (action.type) {
    case 'create_event': {
      const event = await createEvent(
        db,
        {
          title: action.title,
          start: action.start,
          end: action.end,
          allDay: action.allDay,
          timezone: deps.timeZone,
          location: action.location,
          notes: action.notes,
          attendees: action.attendees,
          rrule: action.recurrence,
        },
        now,
      );
      // A reminder 10 minutes before keeps the command useful even if the user
      // never opens the event again.
      if (event.start - 10 * 60_000 > now) {
        await createReminder(
          db,
          {
            kind: 'event',
            sourceId: event.id,
            title: event.title,
            body: 'Starts in 10 minutes',
            triggerAt: event.start - 10 * 60_000,
          },
          now,
        );
      }
      return {message: `Created “${event.title}”`, changed: true};
    }

    case 'update_event': {
      if (action.occurrenceStart !== null) {
        await overrideOccurrence(
          db,
          action.eventId,
          action.occurrenceStart,
          {
            ...(action.title ? {title: action.title} : {}),
            ...(action.start !== undefined ? {start: action.start} : {}),
            ...(action.end !== undefined ? {end: action.end} : {}),
          },
          now,
        );
        return {message: 'Moved this occurrence', changed: true};
      }
      const updated = await updateEvent(
        db,
        action.eventId,
        {
          ...(action.title ? {title: action.title} : {}),
          ...(action.start !== undefined ? {start: action.start} : {}),
          ...(action.end !== undefined ? {end: action.end} : {}),
          ...(action.location !== undefined ? {location: action.location} : {}),
          ...(action.notes !== undefined ? {notes: action.notes} : {}),
        },
        now,
      );
      return {message: `Updated “${updated.title}”`, changed: true};
    }

    case 'delete_event': {
      const deleted = await deleteEvent(
        db,
        action.eventId,
        {
          scope: action.scope,
          ...(action.occurrenceStart !== null ? {occurrenceStart: action.occurrenceStart} : {}),
        },
        now,
      );
      if (action.scope === 'occurrence') {
        return {message: 'Deleted this occurrence', changed: true};
      }
      const undo = await recordUndo(db, 'Delete event', {
        restore: [{table: 'events', ids: deleted.deletedIds}],
      });
      return {message: 'Deleted event', changed: true, undoToken: undo.token};
    }

    case 'create_task': {
      let projectId: string | null = null;
      if (action.projectName) {
        const existing = await findProjectByName(db, action.projectName);
        projectId = existing ? existing.id : (await createProject(db, action.projectName)).id;
      }
      const task = await createTask(
        db,
        {
          title: action.title,
          dueAt: action.dueAt,
          dueHasTime: action.dueHasTime,
          priority: action.priority,
          projectId,
          notes: action.notes,
          recurrence: action.recurrence,
        },
        now,
      );
      if (task.dueAt !== null && task.dueAt - 10 * 60_000 > now) {
        await createReminder(
          db,
          {
            kind: 'task',
            sourceId: task.id,
            title: task.title,
            body: 'Task due in 10 minutes',
            triggerAt: task.dueAt - 10 * 60_000,
          },
          now,
        );
      }
      return {message: `Added task “${task.title}”`, changed: true};
    }

    case 'update_task': {
      const updated = await updateTask(
        db,
        action.taskId,
        {
          ...(action.title ? {title: action.title} : {}),
          ...(action.dueAt !== undefined ? {dueAt: action.dueAt} : {}),
          ...(action.priority !== undefined ? {priority: action.priority} : {}),
        },
        now,
      );
      return {message: `Updated “${updated.title}”`, changed: true};
    }

    case 'complete_task': {
      const result = await completeTask(db, action.taskId, now);
      return {
        message: result.nextTask
          ? `Completed “${result.task.title}” — next due ${result.nextTask.dueAt ? formatDateKey(localDateKey(result.nextTask.dueAt, deps.timeZone), 'short') : 'soon'}`
          : `Completed “${result.task.title}”`,
        changed: true,
      };
    }

    case 'delete_task': {
      const ids = await deleteTask(db, action.taskId, now);
      const undo = await recordUndo(db, 'Delete task', {restore: [{table: 'tasks', ids}]});
      return {message: 'Deleted task', changed: true, undoToken: undo.token};
    }

    case 'create_note': {
      const note = await createNote(db, {title: action.title, body: action.body}, now);
      return {message: `Saved note “${note.title}”`, changed: true};
    }

    case 'set_reminder': {
      const reminder = await createReminder(
        db,
        {kind: 'custom', title: action.title, triggerAt: action.triggerAt},
        now,
      );
      return {
        message: `Reminder set for ${formatTime(reminder.triggerAt, deps.timeZone, deps.clock24h)}`,
        changed: true,
      };
    }

    case 'start_timer':
    case 'start_pomodoro': {
      const running = await activeSession(db);
      if (running) {
        await endSession(db, running.id, false, now);
      }
      await startSession(
        db,
        {
          label: action.label,
          plannedMinutes: action.minutes,
          kind: 'focus',
        },
        now,
      );
      return {
        message: `${action.type === 'start_pomodoro' ? 'Focus session' : 'Timer'} started · ${action.minutes} min`,
        changed: true,
      };
    }

    case 'log_habit': {
      const habitId = action.habitId;
      if (!habitId) {
        throw new Error('Unknown habit');
      }
      const habit = await getHabit(db, habitId);
      if (!habit) {
        throw new Error('Habit not found');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(action.date)) {
        throw new Error('Invalid habit date');
      }
      await setHabitLog(db, habitId, action.date, action.done, now);
      return {message: `${action.done ? 'Logged' : 'Unlogged'} “${habit.name}”`, changed: true};
    }

    case 'query_schedule': {
      const occurrences = await listOccurrences(db, action.rangeStart, action.rangeEnd);
      if (occurrences.length === 0) {
        return {message: 'Schedule', answer: 'Nothing on your calendar for that day.'};
      }
      const lines = occurrences.map(occurrence => {
        const time = occurrence.allDay
          ? 'All day'
          : formatTime(occurrence.start, deps.timeZone, deps.clock24h);
        return `• ${time} — ${occurrence.title}`;
      });
      return {
        message: `Schedule for ${formatDateKey(localDateKey(action.rangeStart, deps.timeZone), 'medium')}`,
        answer: lines.join('\n'),
      };
    }

    case 'query_tasks': {
      const now2 = deps.now ? deps.now() : Date.now();
      const tasks = await listTasks(db, {includeCompleted: false});
      const buckets = bucketTasks(tasks, now2, deps.timeZone);
      const chosen =
        action.filter === 'overdue' ? buckets.overdue
        : action.filter === 'upcoming' ? buckets.upcoming
        : action.filter === 'all' ? [...buckets.overdue, ...buckets.today, ...buckets.upcoming, ...buckets.someday]
        : [...buckets.overdue, ...buckets.today];
      if (chosen.length === 0) {
        return {message: 'Tasks', answer: 'No tasks for that filter.'};
      }
      return {
        message: `${action.filter} tasks`,
        answer: chosen
          .slice(0, 20)
          .map(task => {
            const due = task.dueAt
              ? ` · due ${formatDateKey(localDateKey(task.dueAt, deps.timeZone), 'short')}`
              : '';
            return `• ${task.title}${due}`;
          })
          .join('\n'),
      };
    }

    case 'find_free_time': {
      const dayStart = action.date;
      const dayEnd = dayStart + 86_400_000 - 1;
      const occurrences = await listOccurrences(db, dayStart, dayEnd);
      const slots = findFreeSlots(occurrences, dayStart, deps.timeZone, {
        workdayStart: deps.workdayStart,
        workdayEnd: deps.workdayEnd,
        minMinutes: action.minMinutes,
      });
      if (slots.length === 0) {
        return {
          message: 'Free time',
          answer: `No ${action.minMinutes}+ minute gaps inside your working hours on that day.`,
        };
      }
      return {
        message: 'Free time',
        answer: slots
          .map(
            slot =>
              `• ${formatTime(slot.start, deps.timeZone, deps.clock24h)}–${formatTime(slot.end, deps.timeZone, deps.clock24h)} (${slot.minutes} min)`,
          )
          .join('\n'),
      };
    }

    case 'navigate':
      return {message: `Opening ${action.screen}`, navigateTo: action.screen};

    default:
      throw new Error('Unsupported action');
  }
}

/** Reads a local time-of-day label for widget headers. */
export function hourLabel(ms: number, timeZone: string): string {
  const parts = zonedParts(ms, timeZone);
  return `${parts.hour}:${String(parts.minute).padStart(2, '0')}`;
}
