/**
 * Planner: converts an interpretation into a validated action plan with a
 * human-readable summary, a confidence score and a confirmation decision.
 *
 * The planner never touches the database. It returns either a plan (which the
 * UI shows for confirmation) or a focused clarifying question.
 */
import {
  addDaysToDateKey,
  formatDateKey,
  formatTime,
  localDateKey,
  parseDateKey,
  wallClockToUtc,
  zonedParts,
} from '../domain/time';
import {describeRRule, parseRRule} from '../domain/recurrence';
import type {CalendarEvent} from '../domain/types';
import {interpretCommand, type Interpretation, type InterpretContext} from './parse';
import {
  DESTRUCTIVE_ACTIONS,
  validateAction,
  type AgentAction,
  type Plan,
  type PlanAction,
} from './types';

export interface PlannerContext extends InterpretContext {
  clock24h: boolean;
}

export type PlanningResult =
  | {kind: 'plan'; plan: Plan; interpretation: Interpretation}
  | {kind: 'clarify'; question: string; interpretation: Interpretation}
  | {kind: 'unknown'; message: string; interpretation: Interpretation};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeInstant(ms: number, timeZone: string, clock24h: boolean): string {
  const p = zonedParts(ms, timeZone);
  const key = localDateKey(ms, timeZone);
  return `${WEEKDAYS[p.weekday]}, ${formatDateKey(key, 'short')} · ${formatTime(ms, timeZone, clock24h)}`;
}

export function describeRange(
  start: number,
  end: number,
  timeZone: string,
  clock24h: boolean,
  allDay: boolean,
): string {
  if (allDay) {
    const startKey = localDateKey(start, timeZone);
    const days = Math.max(1, Math.round((end - start) / 86_400_000));
    return days === 1
      ? `${formatDateKey(startKey, 'medium')} (all day)`
      : `${formatDateKey(startKey, 'short')} – ${formatDateKey(localDateKey(end - 1, timeZone), 'short')} (all day)`;
  }
  const startKey = localDateKey(start, timeZone);
  const endKey = localDateKey(end, timeZone);
  if (startKey === endKey) {
    return `${describeInstant(start, timeZone, clock24h)}–${formatTime(end, timeZone, clock24h)}`;
  }
  return `${describeInstant(start, timeZone, clock24h)} – ${describeInstant(end, timeZone, clock24h)}`;
}

function planId(): string {
  return `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function actionId(index: number): string {
  return `act_${index}_${Math.random().toString(36).slice(2, 7)}`;
}

function dayBounds(ms: number, timeZone: string): {start: number; end: number} {
  const key = localDateKey(ms, timeZone);
  const p = parseDateKey(key);
  const next = parseDateKey(addDaysToDateKey(key, 1));
  return {
    start: wallClockToUtc({year: p.year, month: p.month, day: p.day, hour: 0, minute: 0}, timeZone),
    end: wallClockToUtc({year: next.year, month: next.month, day: next.day, hour: 0, minute: 0}, timeZone) - 1,
  };
}

function defaultEventEnd(start: number, minutes: number): number {
  return start + minutes * 60_000;
}

function confirmationFor(action: AgentAction, confidence: number, ambiguous: boolean): boolean {
  if (DESTRUCTIVE_ACTIONS.has(action.type)) {
    return true;
  }
  if (action.type === 'update_event' || action.type === 'update_task' || action.type === 'complete_task') {
    return ambiguous || confidence < 0.8;
  }
  if (action.type === 'create_event' || action.type === 'create_task' || action.type === 'set_reminder') {
    return confidence < 0.65;
  }
  return false;
}

export function planCommand(text: string, ctx: PlannerContext): PlanningResult {
  const interpretation = interpretCommand(text, ctx);
  const temporal = interpretation.temporal;
  const {intent, title} = interpretation;

  const clarify = (question: string): PlanningResult => ({kind: 'clarify', question, interpretation});

  if (text.trim().length === 0) {
    return {kind: 'unknown', message: 'I did not catch a command.', interpretation};
  }

  if (intent === 'unknown') {
    if (title.length === 0) {
      return {
        kind: 'unknown',
        message: 'I could not match that to an action. Try “add standup tomorrow at 9”, “complete task taxes”, or “what’s on my calendar today?”',
        interpretation,
      };
    }
    // A verb that operates on an existing record must never silently become a
    // new record when nothing matched.
    if (/\b(delete|remove|cancel|complete|finish|move|reschedule|rename|update|edit|change)\b/i.test(text)) {
      return clarify('I could not find a matching task or event. Which one do you mean?');
    }
    const creationCue = /^\s*(add|create|new|schedule|book|note|jot|write down|remember|remind me|log|track|set)\b/i.test(
      text,
    );
    if (!creationCue && !temporal.hasDate && !temporal.hasTime) {
      return {
        kind: 'unknown',
        message:
          'I did not understand that. Try “add standup tomorrow at 9”, “add task buy milk”, or “what’s next?”',
        interpretation,
      };
    }
    // A bare phrase with a time is most likely an event; without one, a task.
    const fallback: AgentAction = temporal.hasTime
      ? {
          type: 'create_event',
          title,
          start: temporal.start,
          end: temporal.allDay ? temporal.start + 86_400_000 : defaultEventEnd(temporal.start, ctx.defaultEventMinutes),
          allDay: temporal.allDay,
          location: null,
          notes: null,
          attendees: interpretation.attendees,
          recurrence: temporal.recurrence,
        }
      : {
          type: 'create_task',
          title,
          dueAt: temporal.hasDate ? temporal.start : null,
          dueHasTime: false,
          priority: interpretation.priority ?? 1,
          projectName: interpretation.projectName,
          notes: null,
          recurrence: temporal.recurrence,
        };
    return finishPlan(
      [fallback],
      `Add ${fallback.type === 'create_event' ? 'event' : 'task'} “${title}”`,
      ctx,
      interpretation,
      Math.min(interpretation.confidence, 0.6),
    );
  }

  switch (intent) {
    case 'create_event': {
      if (!title) {
        return clarify('What should I call the event?');
      }
      if (!temporal.hasDate && !temporal.hasTime) {
        return clarify(`When should I schedule “${title}”?`);
      }
      const start = temporal.allDay ? temporal.start : temporal.start;
      const end = temporal.allDay ? start + 86_400_000 : temporal.end;
      return finishPlan(
        [
          {
            type: 'create_event',
            title,
            start,
            end,
            allDay: temporal.allDay,
            location: null,
            notes: null,
            attendees: interpretation.attendees,
            recurrence: temporal.recurrence,
          },
        ],
        `Create event “${title}”`,
        ctx,
        interpretation,
        interpretation.confidence,
      );
    }

    case 'create_task': {
      if (!title) {
        return clarify('What is the task?');
      }
      const dueAt = temporal.hasDate ? temporal.start : null;
      const dueHasTime = temporal.hasTime;
      return finishPlan(
        [
          {
            type: 'create_task',
            title,
            dueAt,
            dueHasTime,
            priority: interpretation.priority ?? 1,
            projectName: interpretation.projectName,
            notes: null,
            recurrence: temporal.recurrence,
          },
        ],
        `Add task “${title}”`,
        ctx,
        interpretation,
        interpretation.confidence,
      );
    }

    case 'create_note': {
      if (!title) {
        return clarify('What should the note say?');
      }
      return finishPlan(
        [{type: 'create_note', title, body: ''}],
        `Create note “${title}”`,
        ctx,
        interpretation,
        interpretation.confidence,
      );
    }

    case 'set_reminder': {
      if (!title) {
        return clarify('What should I remind you about?');
      }
      if (!temporal.hasDate && !temporal.hasTime) {
        return clarify('When should I remind you?');
      }
      if (temporal.start <= ctx.now) {
        return clarify('That time has already passed — when should I remind you?');
      }
      return finishPlan(
        [{type: 'set_reminder', title, triggerAt: temporal.start}],
        `Remind you to “${title}”`,
        ctx,
        interpretation,
        interpretation.confidence,
      );
    }

    case 'complete_task': {
      if (!interpretation.matchedTask) {
        return clarify('Which task did you finish?');
      }
      return finishPlan(
        [{type: 'complete_task', taskId: interpretation.matchedTask.id}],
        `Complete task “${interpretation.matchedTask.title}”`,
        ctx,
        interpretation,
        interpretation.confidence,
      );
    }

    case 'delete_task': {
      if (!interpretation.matchedTask) {
        return clarify('Which task should I delete?');
      }
      return finishPlan(
        [{type: 'delete_task', taskId: interpretation.matchedTask.id}],
        `Delete task “${interpretation.matchedTask.title}”`,
        ctx,
        interpretation,
        interpretation.confidence,
      );
    }

    case 'delete_event': {
      const event = interpretation.matchedEvent;
      if (!event) {
        return clarify('Which event should I delete?');
      }
      const hasRule = Boolean(event.rrule);
      return finishPlan(
        [
          {
            type: 'delete_event',
            eventId: event.id,
            scope: hasRule ? 'occurrence' : 'series',
            occurrenceStart: hasRule ? event.start : null,
          },
        ],
        hasRule
          ? `Delete this occurrence of “${event.title}”`
          : `Delete event “${event.title}”`,
        ctx,
        interpretation,
        interpretation.confidence,
      );
    }

    case 'update_event': {
      const event = interpretation.matchedEvent;
      if (!event) {
        return clarify('Which event should I change?');
      }
      if (!temporal.hasDate && !temporal.hasTime) {
        return clarify('What should I change it to?');
      }
      const recurring = Boolean(event.rrule);
      const duration = event.end - event.start;
      const start = temporal.start;
      const end = temporal.allDay ? start + 86_400_000 : defaultEventEnd(start, Math.round(duration / 60_000));
      const rename = /\b(rename|call it|title)\b/i.test(text);
      return finishPlan(
        [
          {
            type: 'update_event',
            eventId: event.id,
            occurrenceStart: recurring ? event.start : null,
            start,
            end,
            ...(rename && title ? {title} : {}),
          },
        ],
        `Move “${event.title}” to ${describeRange(start, end, ctx.timeZone, ctx.clock24h, temporal.allDay)}`,
        ctx,
        interpretation,
        interpretation.confidence,
      );
    }

    case 'update_task': {
      const task = interpretation.matchedTask;
      if (!task) {
        return clarify('Which task should I change?');
      }
      if (!temporal.hasDate && !interpretation.priority) {
        return clarify('What should I change about it?');
      }
      const patch: AgentAction = {
        type: 'update_task',
        taskId: task.id,
        ...(temporal.hasDate ? {dueAt: temporal.start} : {}),
        ...(interpretation.priority !== null ? {priority: interpretation.priority} : {}),
      };
      return finishPlan(
        [patch],
        `Update task “${task.title}”`,
        ctx,
        interpretation,
        interpretation.confidence,
      );
    }

    case 'log_habit': {
      if (!interpretation.matchedHabit) {
        return clarify('Which habit should I log?');
      }
      const dateKey = temporal.hasDate ? localDateKey(temporal.start, ctx.timeZone) : localDateKey(ctx.now, ctx.timeZone);
      return finishPlan(
        [
          {
            type: 'log_habit',
            habitId: interpretation.matchedHabit.id,
            habitName: interpretation.matchedHabit.name,
            date: dateKey,
            done: true,
          },
        ],
        `Log “${interpretation.matchedHabit.name}” for ${formatDateKey(dateKey, 'short')}`,
        ctx,
        interpretation,
        interpretation.confidence,
      );
    }

    case 'start_timer': {
      const minutes = temporalDurationMinutes(interpretation) ?? 25;
      const label = title || 'Timer';
      return finishPlan(
        [{type: 'start_timer', minutes, label}],
        `Start a ${minutes} minute timer`,
        ctx,
        interpretation,
        interpretation.confidence,
      );
    }

    case 'start_pomodoro': {
      const minutes = temporalDurationMinutes(interpretation) ?? 25;
      const label = title || 'Focus';
      return finishPlan(
        [{type: 'start_pomodoro', minutes, label}],
        `Start a ${minutes} minute focus session`,
        ctx,
        interpretation,
        interpretation.confidence,
      );
    }

    case 'query_schedule': {
      const anchor = temporal.hasDate ? temporal.start : ctx.now;
      const bounds = dayBounds(anchor, ctx.timeZone);
      return finishPlan(
        [{type: 'query_schedule', rangeStart: bounds.start, rangeEnd: bounds.end}],
        `Show your schedule for ${formatDateKey(localDateKey(anchor, ctx.timeZone), 'medium')}`,
        ctx,
        interpretation,
        0.95,
      );
    }

    case 'query_tasks': {
      const filter = /\boverdue\b/i.test(text)
        ? 'overdue'
        : /\b(upcoming|later|next)\b/i.test(text)
          ? 'upcoming'
          : /\ball\b/i.test(text)
            ? 'all'
            : 'today';
      return finishPlan(
        [{type: 'query_tasks', filter}],
        `Show ${filter} tasks`,
        ctx,
        interpretation,
        0.95,
      );
    }

    case 'find_free_time': {
      const anchor = temporal.hasDate ? temporal.start : ctx.now;
      const bounds = dayBounds(anchor, ctx.timeZone);
      const minutes = temporalDurationMinutes(interpretation) ?? 30;
      return finishPlan(
        [{type: 'find_free_time', date: bounds.start, minMinutes: Math.max(5, minutes)}],
        `Find ${minutes}+ free minutes on ${formatDateKey(localDateKey(anchor, ctx.timeZone), 'short')}`,
        ctx,
        interpretation,
        0.92,
      );
    }

    case 'navigate': {
      const match = /\b(calendar|tasks|notes|habits|focus|dashboard|assistant)\b/i.exec(text);
      const screen = (match?.[1]?.toLowerCase() ?? 'dashboard') as
        | 'calendar' | 'tasks' | 'notes' | 'habits' | 'focus' | 'dashboard' | 'assistant';
      return finishPlan(
        [{type: 'navigate', screen}],
        `Open ${screen}`,
        ctx,
        interpretation,
        0.98,
      );
    }

    default:
      return {
        kind: 'unknown',
        message: 'That action is not available.',
        interpretation,
      };
  }
}

function temporalDurationMinutes(interpretation: Interpretation): number | null {
  const notes = interpretation.temporal.notes;
  if (notes.length === 0 && interpretation.temporal.hasTime && interpretation.temporal.hasDate) {
    const minutes = Math.round((interpretation.temporal.end - interpretation.temporal.start) / 60_000);
    return minutes > 0 ? minutes : null;
  }
  const minutes = Math.round((interpretation.temporal.end - interpretation.temporal.start) / 60_000);
  return minutes > 0 ? minutes : null;
}

function finishPlan(
  actions: AgentAction[],
  baseSummary: string,
  ctx: PlannerContext,
  interpretation: Interpretation,
  confidence: number,
): PlanningResult {
  const ambiguous = Boolean(interpretation.ambiguity);
  const built: PlanAction[] = [];
  const issues: string[] = [];
  actions.forEach((action, index) => {
    const actionIssues = validateAction(action, ctx.now);
    if (actionIssues.length > 0) {
      issues.push(...actionIssues.map(issue => issue.message));
      return;
    }
    const summary = summariseAction(action, baseSummary, ctx);
    const requiresConfirmation = confirmationFor(action, confidence, ambiguous);
    built.push({
      id: actionId(index),
      action,
      summary,
      confidence: Math.max(0, Math.min(1, confidence)),
      requiresConfirmation,
    });
  });

  if (built.length === 0) {
    return {
      kind: 'clarify',
      question: issues[0] ?? 'I need a bit more detail to do that.',
      interpretation,
    };
  }

  const plan: Plan = {
    id: planId(),
    interpretation: baseSummary,
    confidence: Math.max(0, Math.min(1, confidence)),
    source: 'deterministic',
    actions: built,
    clarification: ambiguous ? interpretation.ambiguity : null,
  };
  return {kind: 'plan', plan, interpretation};
}

function summariseAction(action: AgentAction, baseSummary: string, ctx: PlannerContext): string {
  switch (action.type) {
    case 'create_event':
      return `${baseSummary} — ${describeRange(
        action.start,
        action.end,
        ctx.timeZone,
        ctx.clock24h,
        action.allDay,
      )}${action.recurrence ? `, ${describeRRule(parseRRule(action.recurrence))}` : ''}`;
    case 'create_task':
      return `${baseSummary}${
        action.dueAt
          ? ` — due ${action.dueAt ? describeInstant(action.dueAt, ctx.timeZone, ctx.clock24h) : ''}`
          : ' — no due date'
      }${action.recurrence ? `, ${describeRRule(parseRRule(action.recurrence))}` : ''}`;
    case 'create_note':
      return baseSummary;
    case 'set_reminder':
      return `${baseSummary} — ${describeInstant(action.triggerAt, ctx.timeZone, ctx.clock24h)}`;
    case 'delete_event':
    case 'delete_task':
      return `${baseSummary} (can be undone)`;
    case 'update_event':
    case 'update_task':
      return baseSummary;
    case 'complete_task':
      return baseSummary;
    case 'log_habit':
      return baseSummary;
    case 'start_timer':
    case 'start_pomodoro':
      return baseSummary;
    case 'query_schedule':
    case 'query_tasks':
    case 'find_free_time':
      return baseSummary;
    case 'navigate':
      return baseSummary;
    default:
      return baseSummary;
  }
}
