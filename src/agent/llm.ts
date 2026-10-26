/**
 * Optional local-LLM planning path.
 *
 * The model runs on-device (llama.cpp) and is only used to *propose* JSON. Its
 * output is parsed defensively and then re-validated by the same zod schema the
 * deterministic parser uses; a plan is discarded entirely if any action fails.
 * There is no grammar-constrained decoding in this integration, so the model's
 * output is treated as untrusted text.
 *
 * The prompt deliberately contains only: the current time, the timezone, the
 * command itself, and (optionally) the user's task/event titles for matching.
 * No calendar contents, notes or transcripts are sent anywhere — there is no
 * network path at all.
 */
import type {InterpretContext} from './parse';
import {
  actionSchema,
  DESTRUCTIVE_ACTIONS,
  planSchema,
  validatePlan,
  type AgentAction,
  type Plan,
  type PlanAction,
} from './types';
import {z} from 'zod';

export interface LlmGenerateRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface LlmGeneration {
  text: string;
  tokensPerSecond?: number;
  durationMs?: number;
}

export interface LocalLlm {
  isReady(): Promise<boolean>;
  generate(request: LlmGenerateRequest, onToken?: (token: string) => void): Promise<LlmGeneration>;
}

const ACTION_HELP = `create_event {title,start,end,allDay,location,notes,attendees,recurrence}
update_event {eventId,occurrenceStart,title,start,end,location,notes}
delete_event {eventId,scope:"series"|"occurrence",occurrenceStart}
create_task {title,dueAt,dueHasTime,priority:0-3,projectName,notes,recurrence}
update_task {taskId,title,dueAt,priority}
complete_task {taskId}
delete_task {taskId}
create_note {title,body}
set_reminder {title,triggerAt}
start_timer {minutes,label}
start_pomodoro {minutes,label}
log_habit {habitId,habitName,date:"YYYY-MM-DD",done}
query_schedule {rangeStart,rangeEnd}
query_tasks {filter:"today"|"overdue"|"upcoming"|"all"}
find_free_time {date,minMinutes}
navigate {screen:"calendar"|"tasks"|"notes"|"habits"|"focus"|"dashboard"|"assistant"}`;

export function buildCommandPrompt(text: string, ctx: InterpretContext): string {
  const nowIso = new Date(ctx.now).toISOString();
  const taskTitles = ctx.tasks.slice(0, 40).map(task => `- ${task.id}: ${task.title}`);
  const eventTitles = ctx.events
    .slice(0, 40)
    .map(event => `- ${event.id}: ${event.title} (${new Date(event.start).toISOString()})`);
  const habitTitles = ctx.habits.slice(0, 40).map(habit => `- ${habit.id}: ${habit.name}`);
  return [
    'You translate one personal-productivity command into JSON.',
    'Never invent ids. Use only the ids listed. If the command is ambiguous, ask a question.',
    'All timestamps are Unix epoch milliseconds in UTC.',
    `Current time: ${nowIso} (${ctx.now})`,
    `User timezone: ${ctx.timeZone}`,
    'Allowed actions and parameters:',
    ACTION_HELP,
    'Known task ids:',
    taskTitles.length > 0 ? taskTitles.join('\n') : '(none)',
    'Known event ids:',
    eventTitles.length > 0 ? eventTitles.join('\n') : '(none)',
    'Known habit ids:',
    habitTitles.length > 0 ? habitTitles.join('\n') : '(none)',
    'Respond with exactly this JSON shape and nothing else:',
    '{"interpretation":"short sentence","confidence":0.0-1.0,"clarification":null,"actions":[{"type":"...","...":...}]}',
    `Command: ${JSON.stringify(text)}`,
  ].join('\n');
}

/** Extracts the first balanced JSON object from model output. */
export function extractJsonObject(raw: string): unknown | null {
  const start = raw.indexOf('{');
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = raw.slice(start, index + 1);
        try {
          return JSON.parse(slice) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const modelActionSchema = z.object({type: z.string()}).passthrough();

export function summariseAction(action: AgentAction): string {
  switch (action.type) {
    case 'create_event':
      return `Create event “${action.title}”`;
    case 'update_event':
      return 'Update event';
    case 'delete_event':
      return 'Delete event';
    case 'create_task':
      return `Add task “${action.title}”`;
    case 'update_task':
      return 'Update task';
    case 'complete_task':
      return 'Complete task';
    case 'delete_task':
      return 'Delete task';
    case 'create_note':
      return `Create note “${action.title}”`;
    case 'set_reminder':
      return `Remind “${action.title}”`;
    case 'start_timer':
      return `Start ${action.minutes} minute timer`;
    case 'start_pomodoro':
      return `Start ${action.minutes} minute focus session`;
    case 'log_habit':
      return `Log habit ${action.habitName ?? action.habitId ?? ''}`.trim();
    case 'query_schedule':
      return 'Show schedule';
    case 'query_tasks':
      return 'Show tasks';
    case 'find_free_time':
      return 'Find free time';
    case 'navigate':
      return `Open ${action.screen}`;
    default:
      return 'Action';
  }
}

/**
 * Asks the local model for a plan and returns it only if every field validates.
 * Returns null on any failure so the caller can fall back to the deterministic
 * parser; malformed model output is never executed.
 */
export async function planWithLlm(
  llm: LocalLlm,
  text: string,
  ctx: InterpretContext,
): Promise<Plan | null> {
  if (!(await llm.isReady())) {
    return null;
  }
  let raw: string;
  try {
    const generation = await llm.generate({
      prompt: buildCommandPrompt(text, ctx),
      maxTokens: 512,
      temperature: 0,
      stopSequences: ['\n\nCommand:', '</json>'],
    });
    raw = generation.text;
  } catch {
    return null;
  }
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const envelope = parsed as Record<string, unknown>;
  const rawActions = Array.isArray(envelope.actions) ? envelope.actions : [];
  if (rawActions.length === 0 || rawActions.length > 10) {
    return null;
  }
  const built: PlanAction[] = [];
  for (let index = 0; index < rawActions.length; index += 1) {
    const candidate = modelActionSchema.safeParse(rawActions[index]);
    if (!candidate.success) {
      return null;
    }
    const action = actionSchema.safeParse(candidate.data);
    if (!action.success) {
      return null;
    }
    const requiresConfirmation = DESTRUCTIVE_ACTIONS.has(action.data.type);
    built.push({
      id: `llm_act_${index}`,
      action: action.data,
      summary: summariseAction(action.data),
      confidence: typeof envelope.confidence === 'number' ? Math.max(0, Math.min(1, envelope.confidence)) : 0.6,
      requiresConfirmation,
    });
  }
  const plan = {
    id: `llm_plan_${ctx.now}`,
    interpretation:
      typeof envelope.interpretation === 'string' && envelope.interpretation.trim()
        ? envelope.interpretation.trim().slice(0, 400)
        : 'Local model interpretation',
    confidence: typeof envelope.confidence === 'number' ? Math.max(0, Math.min(1, envelope.confidence)) : 0.6,
    source: 'llm' as const,
    actions: built,
    clarification:
      typeof envelope.clarification === 'string' && envelope.clarification.trim()
        ? envelope.clarification.trim().slice(0, 400)
        : null,
  };
  const shape = planSchema.safeParse(plan);
  if (!shape.success) {
    return null;
  }
  try {
    return validatePlan(shape.data, ctx.now);
  } catch {
    return null;
  }
}
