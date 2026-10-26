/**
 * Deterministic command interpretation: intent classification plus entity
 * extraction. No network, no model — just ordered rules that are unit tested.
 *
 * Anything this cannot resolve confidently returns intent `'unknown'` or an
 * ambiguity note so the planner can ask a focused question instead of guessing.
 */
import type {CalendarEvent, Habit, Project, Task, TaskPriority} from '../domain/types';
import {addDaysToDateKey, parseDateKey, wallClockToUtc} from '../domain/time';
import {resolveTemporal, stripTemporal, type TemporalContext, type TemporalResult} from './datetime';
import type {ActionType} from './types';

export interface InterpretContext extends TemporalContext {
  events: CalendarEvent[];
  tasks: Task[];
  habits: Habit[];
  projects: Project[];
}

export interface Interpretation {
  intent: ActionType | 'unknown';
  title: string;
  temporal: TemporalResult;
  priority: TaskPriority | null;
  projectName: string | null;
  attendees: string[];
  matchedEvent: CalendarEvent | null;
  matchedTask: Task | null;
  matchedHabit: Habit | null;
  confidence: number;
  ambiguity: string | null;
  normalized: string;
}

const LEADING_FILLER = [
  /^(?:hey |ok |okay |please |could you |can you |would you |i want to |i need to |i'd like to |let's |lets )+/i,
  /^(?:add|create|schedule|book|set up|setup|make|new|put|plan|note|jot down|write down|log|mark|remind me to|remind me|remember)\s+/i,
  /^(?:an?|the)\s+/i,
  /^(?:new\s+)?(?:event|meeting|appointment|task|todo|to-do|note)\s*[:\-]?\s*/i,
];

const TRAILING_FILLER =
  /\s+(?:for me|please|to my calendar|on my calendar|in my calendar|from my calendar|to my list|on my list|to my task list|in my tasks|to the calendar|on the calendar)$/i;

function normalize(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value: string): string {
  if (!value) {
    return value;
  }
  const first = value[0]!;
  return first.toUpperCase() + value.slice(1);
}

export function cleanTitle(text: string): string {
  let remainder = text.replace(TRAILING_FILLER, '').trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of LEADING_FILLER) {
      const next = remainder.replace(pattern, '').trim();
      if (next !== remainder) {
        remainder = next;
        changed = true;
      }
    }
  }
  remainder = remainder.replace(/^[,.;:\-–—\s]+|[,.;:\-–—\s]+$/g, '');
  return titleCase(remainder);
}

interface AttendeesResult {
  attendees: string[];
  rest: string;
}

function extractAttendees(normalized: string): AttendeesResult {
  const match = /\bwith\s+([\p{L}\p{N} .,&'\-]+)$/iu.exec(normalized);
  if (!match) {
    return {attendees: [], rest: normalized};
  }
  const names = match[1]!
    .split(/,|\band\b/i)
    .map(name => name.trim())
    .filter(name => name.length > 0 && name.length <= 80);
  if (names.length === 0) {
    return {attendees: [], rest: normalized};
  }
  return {
    attendees: names.map(titleCase),
    rest: normalized.slice(0, match.index).trim(),
  };
}

function extractPriority(normalized: string): {priority: TaskPriority | null; rest: string} {
  const patterns: [RegExp, TaskPriority][] = [
    [/\b(urgent|asap|critical|highest priority)\b/i, 3],
    [/\b(high priority|important|high)\b/i, 2],
    [/\b(low priority|whenever|someday|low)\b/i, 0],
  ];
  for (const [pattern, priority] of patterns) {
    const match = pattern.exec(normalized);
    if (match) {
      return {priority, rest: normalized.replace(pattern, ' ').replace(/\s+/g, ' ').trim()};
    }
  }
  return {priority: null, rest: normalized};
}

function extractProject(
  normalized: string,
  projects: readonly Project[],
): {projectName: string | null; rest: string} {
  for (const project of projects) {
    const pattern = new RegExp(`\\b(?:in|for|to)\\s+(?:the\\s+)?${escapeRegExp(project.name)}\\b`, 'i');
    if (pattern.test(normalized)) {
      return {projectName: project.name, rest: normalized.replace(pattern, ' ').replace(/\s+/g, ' ').trim()};
    }
  }
  const generic = /\b(?:in|for)\s+(?:the\s+)?([\p{L}\p{N} &'\-]{2,40}?)\s+(?:project|list)\b/iu.exec(normalized);
  if (generic) {
    return {
      projectName: titleCase(generic[1]!.trim()),
      rest: normalized.replace(generic[0], ' ').replace(/\s+/g, ' ').trim(),
    };
  }
  return {projectName: null, rest: normalized};
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1);
}

/** Token-overlap similarity in [0, 1], used to match existing records. */
export function similarity(a: string, b: string): number {
  const at = tokens(a);
  const bt = tokens(b);
  if (at.length === 0 || bt.length === 0) {
    return 0;
  }
  const setB = new Set(bt);
  let shared = 0;
  for (const token of new Set(at)) {
    if (setB.has(token)) {
      shared += 1;
    }
  }
  const containment = at.join(' ').includes(bt.join(' ')) || bt.join(' ').includes(at.join(' ')) ? 0.9 : 0;
  return Math.max(shared / Math.max(at.length, bt.length), containment);
}

interface Match<T> {
  item: T;
  score: number;
  runnerUp: number;
}

function bestMatch<T>(
  query: string,
  items: readonly T[],
  getText: (item: T) => string,
): Match<T> | null {
  let best: {item: T; score: number} | null = null;
  let runnerUp = 0;
  for (const item of items) {
    const score = similarity(query, getText(item));
    if (!best || score > best.score) {
      if (best) {
        runnerUp = Math.max(runnerUp, best.score);
      }
      best = {item, score};
    } else {
      runnerUp = Math.max(runnerUp, score);
    }
  }
  if (!best || best.score < 0.55) {
    return null;
  }
  return {item: best.item, score: best.score, runnerUp};
}

const COMMAND_WORDS =
  /\b(complete|completed|finish|finished|done|delete|remove|erase|cancel|move|rescheduled?|reschedule|push|shift|change|rename|update|edit|log|logged|mark|check|checked|off|hit|track|my|the|a|an|task|tasks|todo|to-do|event|events|meeting|appointment|reminder|from|to|at|on|in|for|with)\b/g;

/** Text left after removing command scaffolding, used for record matching. */
export function targetPhrase(text: string): string {
  return text.replace(COMMAND_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

function detectIntent(
  normalized: string,
  matchText: string,
  ctx: InterpretContext,
): {
  intent: ActionType | 'unknown';
  matchedTask: Task | null;
  matchedEvent: CalendarEvent | null;
  matchedHabit: Habit | null;
  ambiguity: string | null;
  confidence: number;
} {
  const text = normalized;
  const target = targetPhrase(matchText);

  // Queries first: they must not be mistaken for create commands.
  if (
    /\b(free time|free slot|free block|when am i free|find.*(free|gap|opening)|\d+\s*(?:min|minutes?|hours?)\s+free)\b/i.test(
      text,
    )
  ) {
    return {intent: 'find_free_time', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: null, confidence: 0.9};
  }
  if (
    /\b(what'?s (on|next|my)|what is (on|next|my)|my (schedule|agenda)|show (me )?(my )?(schedule|agenda|calendar)|what do i have|upcoming (events|meetings))\b/i.test(
      text,
    )
  ) {
    return {intent: 'query_schedule', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: null, confidence: 0.9};
  }
  if (/\b(my|show|list|what)\b.*\b(tasks?|todos?|to-dos?)\b/i.test(text) || /\boverdue tasks?\b/i.test(text)) {
    return {intent: 'query_tasks', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: null, confidence: 0.88};
  }
  const nav = /\b(?:open|go to|show|take me to)\s+(?:the\s+)?(calendar|tasks|notes|habits|focus|dashboard|assistant)\b/i.exec(text);
  if (nav) {
    return {intent: 'navigate', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: null, confidence: 0.95};
  }

  // Habits: match against real habit names.
  const habitMatch = bestMatch(target || text, ctx.habits, habit => habit.name);
  const habitVerb = /\b(log|logged|check off|checked|did|done|completed|mark|hit|track)\b/i.test(text);
  if (habitMatch && habitVerb) {
    return {
      intent: 'log_habit',
      matchedTask: null,
      matchedEvent: null,
      matchedHabit: habitMatch.item,
      ambiguity: habitMatch.runnerUp > 0.7 ? 'I found more than one matching habit.' : null,
      confidence: Math.min(0.95, habitMatch.score),
    };
  }

  if (/\b(pomodoro|focus session|focus block|deep work|start focus)\b/i.test(text)) {
    return {intent: 'start_pomodoro', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: null, confidence: 0.93};
  }
  if (/\b(timer|countdown)\b/i.test(text) && !/\bremind me\b/i.test(text)) {
    return {intent: 'start_timer', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: null, confidence: 0.9};
  }
  if (/^\s*(remind me|set (a|an) reminder|notify me)\b/i.test(text) || /\breminder\b/i.test(text)) {
    return {intent: 'set_reminder', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: null, confidence: 0.88};
  }

  const completionVerb = /\b(complete|completed|finish|finished|done with|check off|tick off|mark .*?(done|complete)|i did)\b/i.test(text);
  const deleteVerb = /\b(delete|remove|erase|get rid of|cancel)\b/i.test(text);
  const updateVerb = /\b(move|reschedule|push|shift|change|rename|update|edit)\b/i.test(text);
  const noteVerb = /\b(note|jot|write down|remember that|memo)\b/i.test(text);

  // Existing task / event lookup for verbs that operate on a record.
  const query = target || text;
  const taskMatch = bestMatch(query, ctx.tasks.filter(task => task.completedAt === null), task => task.title);
  const eventMatch = bestMatch(
    query,
    ctx.events.filter(event => !event.exceptionParentId),
    event => event.title,
  );

  if (noteVerb && !taskMatch && !eventMatch) {
    return {intent: 'create_note', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: null, confidence: 0.85};
  }

  if (deleteVerb) {
    if (taskMatch && (!eventMatch || taskMatch.score >= eventMatch.score)) {
      return {
        intent: 'delete_task',
        matchedTask: taskMatch.item,
        matchedEvent: null,
        matchedHabit: null,
        ambiguity: eventMatch && eventMatch.score > 0.7 ? 'That matches both a task and an event; I picked the task.' : null,
        confidence: taskMatch.score,
      };
    }
    if (eventMatch) {
      return {
        intent: 'delete_event',
        matchedTask: null,
        matchedEvent: eventMatch.item,
        matchedHabit: null,
        ambiguity: null,
        confidence: eventMatch.score,
      };
    }
    return {intent: 'unknown', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: 'Which item should I delete?', confidence: 0.2};
  }

  if (completionVerb && taskMatch) {
    return {
      intent: 'complete_task',
      matchedTask: taskMatch.item,
      matchedEvent: null,
      matchedHabit: null,
      ambiguity: taskMatch.runnerUp > 0.7 ? 'More than one task matches; I picked the closest.' : null,
      confidence: taskMatch.score,
    };
  }

  if (updateVerb) {
    if (eventMatch && (!taskMatch || eventMatch.score >= taskMatch.score)) {
      return {
        intent: 'update_event',
        matchedTask: null,
        matchedEvent: eventMatch.item,
        matchedHabit: null,
        ambiguity: null,
        confidence: eventMatch.score,
      };
    }
    if (taskMatch) {
      return {
        intent: 'update_task',
        matchedTask: taskMatch.item,
        matchedEvent: null,
        matchedHabit: null,
        ambiguity: null,
        confidence: taskMatch.score,
      };
    }
  }

  // Creation intents
  if (/\b(note|jot|write down|remember that|memo)\b/i.test(text)) {
    return {intent: 'create_note', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: null, confidence: 0.85};
  }
  const taskWords = /\b(task|todo|to-do|to do|checklist|backlog)\b/i.test(text);
  const eventWords = /\b(meeting|event|appointment|lunch|dinner|breakfast|coffee|call|standup|stand-up|sync|interview|class|flight|concert|birthday|calendar)\b/i.test(text);
  if (taskWords && !eventWords) {
    return {intent: 'create_task', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: null, confidence: 0.9};
  }
  if (eventWords) {
    return {intent: 'create_event', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: null, confidence: 0.9};
  }
  return {intent: 'unknown', matchedTask: null, matchedEvent: null, matchedHabit: null, ambiguity: null, confidence: 0.4};
}

function temporalContext(ctx: InterpretContext): TemporalContext {
  return {now: ctx.now, timeZone: ctx.timeZone, defaultEventMinutes: ctx.defaultEventMinutes};
}

export function interpretCommand(rawText: string, ctx: InterpretContext): Interpretation {
  const normalized = normalize(rawText);
  const attendeesResult = extractAttendees(normalized);
  const priorityResult = extractPriority(attendeesResult.rest);
  const projectResult = extractProject(priorityResult.rest, ctx.projects);

  // Resolve time against the text without attendee/priority/project phrases so
  // those words cannot be mistaken for date tokens.
  const temporal = resolveTemporal(projectResult.rest, temporalContext(ctx));
  const workingText = projectResult.rest;

  const withoutTemporal = stripTemporal(workingText, temporal.consumed);
  const detection = detectIntent(workingText, withoutTemporal, ctx);
  const title = cleanTitle(withoutTemporal);

  // Temporal uncertainty only matters for intents that need a date/time. A
  // delete or a completion should not look less certain just because the user
  // did not say "tomorrow".
  const needsTime =
    detection.intent === 'create_event' ||
    detection.intent === 'set_reminder' ||
    detection.intent === 'update_event' ||
    detection.intent === 'find_free_time' ||
    detection.intent === 'query_schedule' ||
    ((detection.intent === 'create_task' || detection.intent === 'update_task') && temporal.hasDate);
  let confidence = needsTime
    ? Math.min(detection.confidence, temporal.confidence + 0.05)
    : detection.confidence;
  if (detection.intent === 'unknown') {
    confidence = Math.min(confidence, 0.35);
  }
  if (
    (detection.intent === 'create_event' || detection.intent === 'create_task' || detection.intent === 'create_note') &&
    title.length === 0
  ) {
    confidence = Math.min(confidence, 0.4);
  }
  if (detection.intent === 'set_reminder' && title.length === 0) {
    confidence = Math.min(confidence, 0.4);
  }

  let ambiguity = detection.ambiguity;
  if (temporal.notes.length > 0) {
    ambiguity = ambiguity ? `${ambiguity} ${temporal.notes.join(' ')}` : temporal.notes.join(' ');
  }

  return {
    intent: detection.intent,
    title,
    temporal,
    priority: priorityResult.priority,
    projectName: projectResult.projectName,
    attendees: attendeesResult.attendees,
    matchedEvent: detection.matchedEvent,
    matchedTask: detection.matchedTask,
    matchedHabit: detection.matchedHabit,
    confidence,
    ambiguity,
    normalized: workingText,
  };
}

/** Local end-of-day timestamp used for date-only task due dates. */
export function endOfLocalDate(timeZone: string, dateKey: string): number {
  const next = parseDateKey(addDaysToDateKey(dateKey, 1));
  return wallClockToUtc({year: next.year, month: next.month, day: next.day, hour: 0, minute: 0}, timeZone) - 1;
}
