/**
 * Domain types. These mirror the SQLite rows one-to-one (nullable columns are
 * `| null`) so repositories can map rows without guessing.
 */
export type ID = string;

export interface CalendarEvent {
  id: ID;
  title: string;
  location: string | null;
  notes: string | null;
  start: number;
  end: number;
  allDay: boolean;
  timezone: string;
  color: string;
  attendees: string[];
  rrule: string | null;
  exceptionParentId: ID | null;
  occurrenceOriginalStart: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface EventInput {
  title: string;
  start: number;
  end: number;
  allDay?: boolean;
  timezone?: string;
  location?: string | null;
  notes?: string | null;
  color?: string;
  attendees?: string[];
  rrule?: string | null;
}

export interface Occurrence {
  eventId: ID;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  color: string;
  location: string | null;
  notes: string | null;
  timezone: string;
  /** Identity of this instance inside a series (series start for one-offs). */
  occurrenceStart: number;
  recurring: boolean;
  isOverride: boolean;
}

export interface EventException {
  id: ID;
  eventId: ID;
  occurrenceStart: number;
  cancelled: boolean;
  overrideEventId: ID | null;
}

export type TaskPriority = 0 | 1 | 2 | 3;

export interface Task {
  id: ID;
  title: string;
  notes: string | null;
  projectId: ID | null;
  parentId: ID | null;
  priority: TaskPriority;
  dueAt: number | null;
  dueHasTime: boolean;
  recurrence: string | null;
  completedAt: number | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface TaskInput {
  title: string;
  notes?: string | null;
  projectId?: ID | null;
  parentId?: ID | null;
  priority?: TaskPriority;
  dueAt?: number | null;
  dueHasTime?: boolean;
  recurrence?: string | null;
}

export interface Project {
  id: ID;
  name: string;
  color: string;
  archived: boolean;
  createdAt: number;
}

export interface Notebook {
  id: ID;
  name: string;
  color: string;
  createdAt: number;
}

export interface Note {
  id: ID;
  title: string;
  body: string;
  notebookId: ID | null;
  tags: string[];
  pinned: boolean;
  journalDate: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Habit {
  id: ID;
  name: string;
  emoji: string;
  color: string;
  /** Days of week the habit is scheduled (0 = Sunday). */
  schedule: number[];
  targetPerWeek: number;
  archived: boolean;
  createdAt: number;
}

export interface HabitLog {
  id: ID;
  habitId: ID;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  value: number;
  createdAt: number;
}

export interface Routine {
  id: ID;
  kind: 'morning' | 'evening';
  name: string;
  items: string[];
  enabled: boolean;
  createdAt: number;
}

export interface Goal {
  id: ID;
  title: string;
  description: string | null;
  metricUnit: string;
  target: number;
  current: number;
  dueDate: string | null;
  status: 'active' | 'done' | 'archived';
  createdAt: number;
  updatedAt: number;
}

export interface FocusSession {
  id: ID;
  kind: 'focus' | 'break';
  label: string;
  taskId: ID | null;
  startedAt: number;
  endedAt: number | null;
  plannedMinutes: number;
  completed: boolean;
  createdAt: number;
}

export interface TimeEntry {
  id: ID;
  label: string;
  category: string;
  startedAt: number;
  endedAt: number | null;
  source: 'manual' | 'focus';
  createdAt: number;
}

export interface MoodCheckin {
  id: ID;
  date: string;
  mood: number;
  energy: number;
  note: string | null;
  createdAt: number;
}

export interface Intention {
  id: ID;
  date: string;
  text: string;
  createdAt: number;
}

export interface Reflection {
  id: ID;
  weekStart: string;
  wins: string;
  blockers: string;
  nextSteps: string;
  createdAt: number;
}

export type ReminderKind = 'event' | 'task' | 'custom';

export interface Reminder {
  id: ID;
  kind: ReminderKind;
  sourceId: ID | null;
  title: string;
  body: string | null;
  triggerAt: number;
  firedAt: number | null;
  dismissedAt: number | null;
  createdAt: number;
}

export interface WidgetPlacement {
  id: ID;
  kind: string;
  position: number;
  span: number;
  config: Record<string, unknown>;
}

export interface FavoriteAction {
  id: ID;
  action: string;
  label: string;
  position: number;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  weekStartsOn: 0 | 1;
  clock24h: boolean;
  workdayStart: number;
  workdayEnd: number;
  defaultEventMinutes: number;
  retainTranscripts: boolean;
  autoExecuteSafeCommands: boolean;
  onboarded: boolean;
  wifiOnlyDownloads: boolean;
  modelDir: string;
  pomodoroMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  notificationsEnabled: boolean;
  hapticsEnabled: boolean;
  calendarTimeZone: string;
}

export interface SearchHit {
  kind: 'event' | 'task' | 'note';
  id: ID;
  title: string;
  snippet: string;
  timestamp: number;
}
