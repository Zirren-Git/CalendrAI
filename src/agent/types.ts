/**
 * Action contract for the local agent.
 *
 * Anything the assistant can do is one of these actions. Both the deterministic
 * parser and the optional local LLM must produce this shape; `validatePlan`
 * re-checks every field before anything reaches the database. The model never
 * gets SQL, filesystem or network access — only these verbs.
 */
import {z} from 'zod';

const timestamp = z.number().int().finite();
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().max(20_000);
// Literal union so the inferred type matches the domain's TaskPriority.
const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const createEventAction = z.object({
  type: z.literal('create_event'),
  title: shortText,
  start: timestamp,
  end: timestamp,
  allDay: z.boolean().default(false),
  location: z.string().max(200).nullable().default(null),
  notes: longText.nullable().default(null),
  attendees: z.array(z.string().max(120)).max(50).default([]),
  recurrence: z.string().max(200).nullable().default(null),
});

export const updateEventAction = z.object({
  type: z.literal('update_event'),
  eventId: z.string().min(1),
  occurrenceStart: timestamp.nullable().default(null),
  title: shortText.optional(),
  start: timestamp.optional(),
  end: timestamp.optional(),
  location: z.string().max(200).nullable().optional(),
  notes: longText.nullable().optional(),
});

export const deleteEventAction = z.object({
  type: z.literal('delete_event'),
  eventId: z.string().min(1),
  scope: z.enum(['series', 'occurrence']).default('series'),
  occurrenceStart: timestamp.nullable().default(null),
});

export const createTaskAction = z.object({
  type: z.literal('create_task'),
  title: shortText,
  dueAt: timestamp.nullable().default(null),
  dueHasTime: z.boolean().default(false),
  priority: priority.default(1),
  projectName: z.string().max(80).nullable().default(null),
  notes: longText.nullable().default(null),
  recurrence: z.string().max(200).nullable().default(null),
});

export const updateTaskAction = z.object({
  type: z.literal('update_task'),
  taskId: z.string().min(1),
  title: shortText.optional(),
  dueAt: timestamp.nullable().optional(),
  priority: priority.optional(),
});

export const completeTaskAction = z.object({
  type: z.literal('complete_task'),
  taskId: z.string().min(1),
});

export const deleteTaskAction = z.object({
  type: z.literal('delete_task'),
  taskId: z.string().min(1),
});

export const createNoteAction = z.object({
  type: z.literal('create_note'),
  title: shortText,
  body: longText.default(''),
});

export const setReminderAction = z.object({
  type: z.literal('set_reminder'),
  title: shortText,
  triggerAt: timestamp,
});

export const startTimerAction = z.object({
  type: z.literal('start_timer'),
  minutes: z.number().int().min(1).max(180),
  label: z.string().max(80).default('Timer'),
});

export const startPomodoroAction = z.object({
  type: z.literal('start_pomodoro'),
  minutes: z.number().int().min(1).max(180).default(25),
  label: z.string().max(80).default('Focus'),
});

export const logHabitAction = z.object({
  type: z.literal('log_habit'),
  habitId: z.string().min(1).nullable().default(null),
  habitName: z.string().max(80).nullable().default(null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  done: z.boolean().default(true),
});

export const queryScheduleAction = z.object({
  type: z.literal('query_schedule'),
  rangeStart: timestamp,
  rangeEnd: timestamp,
});

export const queryTasksAction = z.object({
  type: z.literal('query_tasks'),
  filter: z.enum(['today', 'overdue', 'upcoming', 'all']).default('today'),
});

export const findFreeTimeAction = z.object({
  type: z.literal('find_free_time'),
  date: timestamp,
  minMinutes: z.number().int().min(5).max(480).default(30),
});

export const navigateAction = z.object({
  type: z.literal('navigate'),
  screen: z.enum(['calendar', 'tasks', 'notes', 'habits', 'focus', 'dashboard', 'assistant']),
});

export const actionSchema = z.discriminatedUnion('type', [
  createEventAction,
  updateEventAction,
  deleteEventAction,
  createTaskAction,
  updateTaskAction,
  completeTaskAction,
  deleteTaskAction,
  createNoteAction,
  setReminderAction,
  startTimerAction,
  startPomodoroAction,
  logHabitAction,
  queryScheduleAction,
  queryTasksAction,
  findFreeTimeAction,
  navigateAction,
]);

export type AgentAction = z.infer<typeof actionSchema>;
export type ActionType = AgentAction['type'];

export const planActionSchema = z.object({
  id: z.string().min(1),
  action: actionSchema,
  summary: z.string().min(1).max(300),
  confidence: z.number().min(0).max(1),
  requiresConfirmation: z.boolean(),
});

export type PlanAction = z.infer<typeof planActionSchema>;

export const planSchema = z.object({
  id: z.string().min(1),
  interpretation: z.string().min(1).max(400),
  confidence: z.number().min(0).max(1),
  source: z.enum(['deterministic', 'llm']),
  actions: z.array(planActionSchema).min(1).max(20),
  clarification: z.string().max(400).nullable().default(null),
});

export type Plan = z.infer<typeof planSchema>;

export const DESTRUCTIVE_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  'delete_event',
  'delete_task',
]);

export const QUERY_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  'query_schedule',
  'query_tasks',
  'find_free_time',
]);

/** Actions that are safe to auto-run when the user opts in. */
export const SAFE_AUTO_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  'query_schedule',
  'query_tasks',
  'find_free_time',
  'navigate',
  'start_timer',
  'start_pomodoro',
]);

export interface ActionIssue {
  path: string;
  message: string;
}

/**
 * Cross-field validation that a per-action schema cannot express. Returns an
 * empty array when the plan may be shown to the user.
 */
export function validateAction(action: AgentAction, now: number): ActionIssue[] {
  const issues: ActionIssue[] = [];
  const DAY = 86_400_000;
  switch (action.type) {
    case 'create_event': {
      if (action.end <= action.start) {
        issues.push({path: 'end', message: 'Event must end after it starts'});
      }
      if (action.end - action.start > 30 * DAY) {
        issues.push({path: 'end', message: 'Event is longer than 30 days'});
      }
      if (action.start < now - 365 * DAY) {
        issues.push({path: 'start', message: 'Event is more than a year in the past'});
      }
      break;
    }
    case 'update_event': {
      if (
        action.title === undefined &&
        action.start === undefined &&
        action.end === undefined &&
        action.location === undefined &&
        action.notes === undefined
      ) {
        issues.push({path: 'action', message: 'Nothing to change'});
      }
      if (action.start !== undefined && action.end !== undefined && action.end <= action.start) {
        issues.push({path: 'end', message: 'Event must end after it starts'});
      }
      break;
    }
    case 'delete_event': {
      if (action.scope === 'occurrence' && action.occurrenceStart === null) {
        issues.push({path: 'occurrenceStart', message: 'Which occurrence?'});
      }
      break;
    }
    case 'create_task': {
      if (action.dueAt !== null && action.dueAt < now - 365 * DAY) {
        issues.push({path: 'dueAt', message: 'Due date is far in the past'});
      }
      break;
    }
    case 'set_reminder': {
      if (action.triggerAt <= now) {
        issues.push({path: 'triggerAt', message: 'Reminder time is in the past'});
      }
      break;
    }
    case 'find_free_time': {
      if (action.date < now - 30 * DAY) {
        issues.push({path: 'date', message: 'Pick a date that is not long past'});
      }
      break;
    }
    case 'log_habit': {
      if (!action.habitId && !action.habitName) {
        issues.push({path: 'habitId', message: 'Which habit?'});
      }
      break;
    }
    default:
      break;
  }
  return issues;
}

/** Validates a raw plan (e.g. parsed LLM JSON) and enforces safety policy. */
export function validatePlan(input: unknown, now: number): Plan {
  const plan = planSchema.parse(input);
  for (const entry of plan.actions) {
    const issues = validateAction(entry.action, now);
    if (issues.length > 0) {
      throw new Error(`Invalid action ${entry.action.type}: ${issues.map(i => i.message).join('; ')}`);
    }
    if (DESTRUCTIVE_ACTIONS.has(entry.action.type) && !entry.requiresConfirmation) {
      throw new Error('Destructive actions must require confirmation');
    }
  }
  return plan;
}
