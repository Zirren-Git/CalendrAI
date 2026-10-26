import {asBool, asNullableString, asNumber, asString, parseJsonArray} from '../db/driver';
import type {
  CalendarEvent,
  EventException,
  FavoriteAction,
  FocusSession,
  Goal,
  Habit,
  HabitLog,
  Intention,
  MoodCheckin,
  Note,
  Notebook,
  Project,
  Reflection,
  Reminder,
  Routine,
  Task,
  TaskPriority,
  TimeEntry,
  WidgetPlacement,
} from '../domain/types';

export function newId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function toEvent(row: Record<string, unknown>): CalendarEvent {
  return {
    id: asString(row.id),
    title: asString(row.title),
    location: asNullableString(row.location),
    notes: asNullableString(row.notes),
    start: asNumber(row.start_at),
    end: asNumber(row.end_at),
    allDay: asBool(row.all_day),
    timezone: asString(row.timezone, 'UTC'),
    color: asString(row.color, '#C25E3A'),
    attendees: parseJsonArray(row.attendees),
    rrule: asNullableString(row.rrule),
    exceptionParentId: asNullableString(row.exception_parent_id),
    occurrenceOriginalStart:
      row.occurrence_original_start == null ? null : asNumber(row.occurrence_original_start),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

export function toException(row: Record<string, unknown>): EventException {
  return {
    id: asString(row.id),
    eventId: asString(row.event_id),
    occurrenceStart: asNumber(row.occurrence_start),
    cancelled: asBool(row.cancelled),
    overrideEventId: asNullableString(row.override_event_id),
  };
}

export function toTask(row: Record<string, unknown>): Task {
  const priorityRaw = asNumber(row.priority, 1);
  const priority = (priorityRaw >= 0 && priorityRaw <= 3 ? priorityRaw : 1) as TaskPriority;
  return {
    id: asString(row.id),
    title: asString(row.title),
    notes: asNullableString(row.notes),
    projectId: asNullableString(row.project_id),
    parentId: asNullableString(row.parent_id),
    priority,
    dueAt: row.due_at == null ? null : asNumber(row.due_at),
    dueHasTime: asBool(row.due_has_time),
    recurrence: asNullableString(row.recurrence),
    completedAt: row.completed_at == null ? null : asNumber(row.completed_at),
    sortOrder: asNumber(row.sort_order),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

export function toProject(row: Record<string, unknown>): Project {
  return {
    id: asString(row.id),
    name: asString(row.name),
    color: asString(row.color, '#6F7F63'),
    archived: asBool(row.archived),
    createdAt: asNumber(row.created_at),
  };
}

export function toNotebook(row: Record<string, unknown>): Notebook {
  return {
    id: asString(row.id),
    name: asString(row.name),
    color: asString(row.color, '#6F7F63'),
    createdAt: asNumber(row.created_at),
  };
}

export function toNote(row: Record<string, unknown>): Note {
  return {
    id: asString(row.id),
    title: asString(row.title),
    body: asString(row.body),
    notebookId: asNullableString(row.notebook_id),
    tags: parseJsonArray(row.tags),
    pinned: asBool(row.pinned),
    journalDate: asNullableString(row.journal_date),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

export function toHabit(row: Record<string, unknown>): Habit {
  const schedule = parseJsonArray(row.schedule)
    .map(Number)
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
  return {
    id: asString(row.id),
    name: asString(row.name),
    emoji: asString(row.emoji, '•'),
    color: asString(row.color, '#6F7F63'),
    schedule: schedule.length > 0 ? schedule : [0, 1, 2, 3, 4, 5, 6],
    targetPerWeek: asNumber(row.target_per_week, 7),
    archived: asBool(row.archived),
    createdAt: asNumber(row.created_at),
  };
}

export function toHabitLog(row: Record<string, unknown>): HabitLog {
  return {
    id: asString(row.id),
    habitId: asString(row.habit_id),
    date: asString(row.date),
    value: asNumber(row.value, 1),
    createdAt: asNumber(row.created_at),
  };
}

export function toRoutine(row: Record<string, unknown>): Routine {
  const kind = asString(row.kind) === 'evening' ? 'evening' : 'morning';
  return {
    id: asString(row.id),
    kind,
    name: asString(row.name),
    items: parseJsonArray(row.items),
    enabled: asBool(row.enabled),
    createdAt: asNumber(row.created_at),
  };
}

export function toGoal(row: Record<string, unknown>): Goal {
  const status = asString(row.status);
  return {
    id: asString(row.id),
    title: asString(row.title),
    description: asNullableString(row.description),
    metricUnit: asString(row.metric_unit),
    target: asNumber(row.target, 1),
    current: asNumber(row.current, 0),
    dueDate: asNullableString(row.due_date),
    status: status === 'done' || status === 'archived' ? status : 'active',
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

export function toFocusSession(row: Record<string, unknown>): FocusSession {
  return {
    id: asString(row.id),
    kind: asString(row.kind) === 'break' ? 'break' : 'focus',
    label: asString(row.label, 'Focus'),
    taskId: asNullableString(row.task_id),
    startedAt: asNumber(row.started_at),
    endedAt: row.ended_at == null ? null : asNumber(row.ended_at),
    plannedMinutes: asNumber(row.planned_minutes, 25),
    completed: asBool(row.completed),
    createdAt: asNumber(row.created_at),
  };
}

export function toTimeEntry(row: Record<string, unknown>): TimeEntry {
  return {
    id: asString(row.id),
    label: asString(row.label),
    category: asString(row.category, 'general'),
    startedAt: asNumber(row.started_at),
    endedAt: row.ended_at == null ? null : asNumber(row.ended_at),
    source: asString(row.source) === 'focus' ? 'focus' : 'manual',
    createdAt: asNumber(row.created_at),
  };
}

export function toMood(row: Record<string, unknown>): MoodCheckin {
  return {
    id: asString(row.id),
    date: asString(row.date),
    mood: asNumber(row.mood, 3),
    energy: asNumber(row.energy, 3),
    note: asNullableString(row.note),
    createdAt: asNumber(row.created_at),
  };
}

export function toIntention(row: Record<string, unknown>): Intention {
  return {
    id: asString(row.id),
    date: asString(row.date),
    text: asString(row.text),
    createdAt: asNumber(row.created_at),
  };
}

export function toReflection(row: Record<string, unknown>): Reflection {
  return {
    id: asString(row.id),
    weekStart: asString(row.week_start),
    wins: asString(row.wins),
    blockers: asString(row.blockers),
    nextSteps: asString(row.next_steps),
    createdAt: asNumber(row.created_at),
  };
}

export function toReminder(row: Record<string, unknown>): Reminder {
  const kindRaw = asString(row.kind);
  const kind = kindRaw === 'event' || kindRaw === 'task' ? kindRaw : 'custom';
  return {
    id: asString(row.id),
    kind,
    sourceId: asNullableString(row.source_id),
    title: asString(row.title),
    body: asNullableString(row.body),
    triggerAt: asNumber(row.trigger_at),
    firedAt: row.fired_at == null ? null : asNumber(row.fired_at),
    dismissedAt: row.dismissed_at == null ? null : asNumber(row.dismissed_at),
    createdAt: asNumber(row.created_at),
  };
}

export function toPlacement(row: Record<string, unknown>): WidgetPlacement {
  let config: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(asString(row.config, '{}'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch {
    config = {};
  }
  return {
    id: asString(row.id),
    kind: asString(row.kind),
    position: asNumber(row.position),
    span: asNumber(row.span, 2),
    config,
  };
}

export function toFavorite(row: Record<string, unknown>): FavoriteAction {
  return {
    id: asString(row.id),
    action: asString(row.action),
    label: asString(row.label),
    position: asNumber(row.position),
  };
}
