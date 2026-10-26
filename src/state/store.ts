/**
 * Single application store.
 *
 * Screens never touch SQL directly: they read the snapshot and call the typed
 * actions below, which are the same services the assistant executes. Every
 * mutation refreshes the snapshot and then updates the two derived surfaces
 * that live outside React — the launcher-widget occurrence cache and the
 * native reminder scheduler.
 */
import {create} from 'zustand';
import type {SqlDriver} from '../db/driver';
import {openAppDatabase} from '../db/platform';
import {
  DEFAULT_SETTINGS,
  applyUndo,
  latestUndo,
  listWidgetLayout,
  logAssistantTurn,
  recordUndo,
  resetWidgetLayout,
  saveWidgetLayout,
  setSetting,
  updateWidgetConfig,
  type UndoEntry,
} from '../repos/system';
import type {
  CalendarEvent,
  EventInput,
  FavoriteAction,
  FocusSession,
  Goal,
  Habit,
  HabitLog,
  ID,
  Intention,
  MoodCheckin,
  Notebook,
  Note,
  Occurrence,
  Project,
  Reflection,
  Reminder,
  Routine,
  Settings,
  Task,
  TaskInput,
  TimeEntry,
  WidgetPlacement,
} from '../domain/types';
import {
  createEvent,
  deleteEvent,
  listEvents,
  listOccurrences,
  updateEvent,
  type EventPatch,
} from '../repos/events';
import {
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  projectProgress,
  reopenTask,
  updateTask,
} from '../repos/tasks';
import {
  createNote,
  deleteNote as deleteNoteRepo,
  listNotes,
  listNotebooks,
  updateNote,
  type NotePatch,
} from '../repos/notes';
import {
  createHabit,
  listHabitLogs,
  listHabits,
  setHabitLog,
  updateHabit,
} from '../repos/habits';
import {
  createGoal,
  ensureRoutines,
  getIntention,
  getMood,
  getReflection,
  listFavorites,
  listGoals,
  listProjects,
  listRoutines,
  recentMoods,
  routineLogs,
  saveReflection as saveReflectionRepo,
  setIntention as setIntentionRepo,
  setMood as setMoodRepo,
  setRoutineLog,
  updateGoal,
  updateRoutine,
  type RoutineLog,
} from '../repos/planning';
import {
  activeSession,
  endSession,
  recentSessions,
  sessionsBetween,
  startSession,
  timeEntriesBetween,
} from '../repos/focus';
import {
  createReminder,
  dismissReminder as dismissReminderRepo,
  listReminders,
} from '../repos/reminders';
import {refreshOccurrenceCache} from '../repos/occurrenceCache';
import {search as searchRepo} from '../repos/search';
import type {SearchHit} from '../domain/types';
import {
  addDaysToDateKey,
  localDateKey,
  startOfLocalDay,
  wallClockToUtc,
} from '../domain/time';
import {runAssistantCommand, planAssistantCommand, type PlanResponse} from '../agent/assistant';
import {executePlan, type ExecutionOutcome} from '../agent/executor';
import type {Plan} from '../agent/types';
import {launcherWidgets, reminders as reminderBridge} from '../native/index';
import {modelsSupported, createModelManager} from '../services/models';
import {
  cancelRecording,
  releaseWhisper,
  speechReady,
  startRecording,
  stopRecording,
  transcribe,
} from '../services/speech';
import {LlamaLocalLlm} from '../services/localLlm';
import type {ModelManager} from '../models/manager';
import type {DownloadProgress, ModelState} from '../models/types';
import {ModelError} from '../models/types';

export interface Snapshot {
  now: number;
  todayKey: string;
  occurrences: Occurrence[];
  events: CalendarEvent[];
  tasks: Task[];
  projects: Project[];
  projectStats: Record<string, {total: number; done: number}>;
  notes: Note[];
  notebooks: Notebook[];
  habits: Habit[];
  habitLogs: HabitLog[];
  routines: Routine[];
  routineLogs: RoutineLog[];
  goals: Goal[];
  focusToday: FocusSession[];
  recentSessions: FocusSession[];
  activeFocus: FocusSession | null;
  timeEntriesToday: TimeEntry[];
  mood: MoodCheckin | null;
  moods: MoodCheckin[];
  intention: Intention | null;
  reflection: Reflection | null;
  reminders: Reminder[];
  widgets: WidgetPlacement[];
  favorites: FavoriteAction[];
  modelStates: ModelState[];
}

export type Notice = {kind: 'info' | 'error' | 'success'; message: string};

interface StoreState {
  ready: boolean;
  bootError: string | null;
  db: SqlDriver | null;
  settings: Settings;
  snapshot: Snapshot | null;
  undo: UndoEntry | null;
  notice: Notice | null;
  modelManager: ModelManager | null;
  modelsSupported: boolean;
  modelProgress: Record<string, number>;
  llmModelId: string | null;
  busy: string | null;
  lastPlan: PlanResponse | null;
  lastOutcome: ExecutionOutcome | null;
  transcript: string | null;
  recording: boolean;
  boot: () => Promise<void>;
  refresh: () => Promise<void>;
  notify: (notice: Notice | null) => void;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
  // events
  saveEvent: (input: EventInput, id?: ID) => Promise<CalendarEvent>;
  patchEvent: (id: ID, patch: EventPatch) => Promise<void>;
  removeEvent: (id: ID, scope: 'series' | 'occurrence', occurrenceStart?: number) => Promise<void>;
  // tasks
  saveTask: (input: TaskInput, id?: ID) => Promise<Task>;
  toggleTask: (task: Task) => Promise<void>;
  removeTask: (id: ID) => Promise<void>;
  // notes
  saveNote: (input: {title: string; body: string; notebookId: ID | null; tags: string[]; pinned: boolean}, id?: ID) => Promise<Note>;
  removeNote: (id: ID) => Promise<void>;
  togglePin: (note: Note) => Promise<void>;
  createNotebook: (name: string) => Promise<void>;
  // habits
  addHabit: (input: {name: string; emoji: string; schedule: number[]}) => Promise<void>;
  toggleHabit: (habitId: ID, dateKey: string) => Promise<void>;
  archiveHabit: (habitId: ID) => Promise<void>;
  toggleRoutineItem: (routineId: ID, item: string, done: boolean) => Promise<void>;
  setRoutineEnabled: (routineId: ID, enabled: boolean) => Promise<void>;
  // planning
  addProject: (name: string) => Promise<void>;
  addGoal: (title: string, target: number, unit: string) => Promise<void>;
  bumpGoal: (goal: Goal, delta: number) => Promise<void>;
  saveMood: (mood: number, energy: number) => Promise<void>;
  saveIntention: (text: string) => Promise<void>;
  saveReflection: (fields: {wins: string; blockers: string; nextSteps: string}) => Promise<void>;
  addReminder: (title: string, triggerAt: number) => Promise<void>;
  dismissReminder: (id: ID) => Promise<void>;
  // focus
  beginFocus: (minutes: number, label: string, kind: 'focus' | 'break', taskId: ID | null) => Promise<FocusSession>;
  finishFocus: (completed: boolean) => Promise<void>;
  logTime: (label: string, minutes: number, category: string) => Promise<void>;
  // widgets
  reorderWidgets: (placements: {kind: string; span: number; config: Record<string, unknown>}[]) => Promise<void>;
  addWidget: (kind: string, span: number) => Promise<void>;
  removeWidget: (id: ID) => Promise<void>;
  configureWidget: (id: ID, config: Record<string, unknown>) => Promise<void>;
  resetWidgets: () => Promise<void>;
  // models
  refreshModels: () => Promise<void>;
  downloadModel: (id: string) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  verifyModel: (id: string) => Promise<void>;
  installBundledModels: () => Promise<void>;
  // assistant
  planText: (text: string) => Promise<PlanResponse | null>;
  confirmPlan: (plan: Plan) => Promise<ExecutionOutcome | null>;
  clearPlan: () => void;
  startVoice: () => Promise<void>;
  stopVoice: () => Promise<void>;
  undoLast: () => Promise<void>;
  search: (query: string) => Promise<SearchHit[]>;
  syncDerived: () => Promise<void>;
}

async function loadSnapshot(
  db: SqlDriver,
  settings: Settings,
  manager: ModelManager | null,
  now = Date.now(),
): Promise<Snapshot> {
  const tz = settings.calendarTimeZone;
  const todayKey = localDateKey(now, tz);
  const rangeStart = wallClockToUtc(
    {...dateParts(addDaysToDateKey(todayKey, -7)), hour: 0, minute: 0},
    tz,
  );
  const rangeEnd = wallClockToUtc(
    {...dateParts(addDaysToDateKey(todayKey, 45)), hour: 23, minute: 59},
    tz,
  );
  const todayStart = startOfLocalDay(now, tz);

  const [
    occurrences,
    tasks,
    projects,
    notes,
    notebooks,
    habits,
    habitLogs,
    routines,
    goals,
    focusToday,
    recent,
    active,
    timeEntriesToday,
    mood,
    moods,
    intention,
    reflection,
    reminderRows,
    widgets,
    favorites,
    logs,
  ] = await Promise.all([
    listOccurrences(db, rangeStart, rangeEnd),
    listTasks(db, {includeCompleted: true, limit: 800}),
    listProjects(db),
    listNotes(db, {limit: 400}),
    listNotebooks(db),
    listHabits(db),
    listHabitLogs(db, addDaysToDateKey(todayKey, -120), addDaysToDateKey(todayKey, 1)),
    listRoutines(db),
    listGoals(db),
    sessionsBetween(db, todayStart, now + 86_400_000),
    recentSessions(db, 60),
    activeSession(db),
    timeEntriesBetween(db, todayStart, now + 86_400_000),
    getMood(db, todayKey),
    recentMoods(db, 30),
    getIntention(db, todayKey),
    getReflection(db, weekStartKey(todayKey)),
    listReminders(db),
    listWidgetLayout(db),
    listFavorites(db),
    routineLogs(db, todayKey),
  ]);

  const projectStats: Record<string, {total: number; done: number}> = {};
  for (const project of projects) {
    projectStats[project.id] = await projectProgress(db, project.id);
  }

  const events = await listEvents(db, {rangeStart, rangeEnd});

  return {
    now,
    todayKey,
    occurrences,
    events,
    tasks,
    projects,
    projectStats,
    notes,
    notebooks,
    habits,
    habitLogs,
    routines,
    routineLogs: logs,
    goals,
    focusToday,
    recentSessions: recent,
    activeFocus: active,
    timeEntriesToday,
    mood,
    moods,
    intention,
    reflection,
    reminders: reminderRows,
    widgets,
    favorites,
    modelStates: manager ? await manager.states() : [],
  };
}

function dateParts(key: string): {year: number; month: number; day: number} {
  const [year, month, day] = key.split('-').map(Number);
  return {year: year ?? 1970, month: month ?? 1, day: day ?? 1};
}

function weekStartKey(todayKey: string): string {
  const date = new Date(`${todayKey}T00:00:00Z`);
  const weekday = date.getUTCDay();
  const offset = (weekday + 6) % 7;
  return addDaysToDateKey(todayKey, -offset);
}

export const useStore = create<StoreState>()((set, get) => ({
  ready: false,
  bootError: null,
  db: null,
  settings: DEFAULT_SETTINGS,
  snapshot: null,
  undo: null,
  notice: null,
  modelManager: null,
  modelsSupported: modelsSupported(),
  modelProgress: {},
  llmModelId: null,
  busy: null,
  lastPlan: null,
  lastOutcome: null,
  transcript: null,
  recording: false,

  notify: notice => set({notice}),

  boot: async () => {
    if (get().db) {
      return;
    }
    try {
      const {driver, boot} = await openAppDatabase();
      let manager: ModelManager | null = null;
      if (modelsSupported()) {
        manager = await createModelManager(boot.settings.wifiOnlyDownloads);
        await manager.ensureBundled().catch(() => undefined);
      }
      const snapshot = await loadSnapshot(driver, boot.settings, manager);
      const undo = await latestUndo(driver);
      const llm = snapshot.modelStates.find(
        state => state.status === 'installed' && snapshot.modelStates.length > 0 && isLlm(state.id),
      );
      set({
        db: driver,
        settings: boot.settings,
        snapshot,
        modelManager: manager,
        undo,
        llmModelId: llm?.id ?? null,
        ready: true,
        bootError: null,
      });
      await get().syncDerived();
    } catch (error) {
      set({
        bootError: error instanceof Error ? error.message : 'The local database could not be opened.',
        ready: true,
      });
    }
  },

  refresh: async () => {
    const {db, settings, modelManager} = get();
    if (!db) {
      return;
    }
    const snapshot = await loadSnapshot(db, settings, modelManager);
    set({snapshot});
  },

  syncDerived: async () => {
    const {db, settings} = get();
    if (!db) {
      return;
    }
    try {
      await refreshOccurrenceCache(db, {timeZone: settings.calendarTimeZone, now: Date.now()});
    } catch {
      // The cache is derived data; a failure must not block the user's edit.
    }
    try {
      await launcherWidgets.refresh();
    } catch {
      // Launcher widgets are optional.
    }
    try {
      if (reminderBridge.available()) {
        await reminderBridge.module().syncFromDatabase();
      }
    } catch {
      // Scheduling is best-effort; reminders still exist in the database.
    }
  },

  updateSetting: async (key, value) => {
    const {db, settings, modelManager} = get();
    if (!db) {
      return;
    }
    await setSetting(db, key, value);
    const next: Settings = {...settings, [key]: value};
    let nextManager = modelManager;
    if (key === 'wifiOnlyDownloads' && modelsSupported()) {
      nextManager = await createModelManager(Boolean(value));
    }
    set({settings: next, modelManager: nextManager});
    if (key === 'theme' || key === 'calendarTimeZone' || key === 'weekStartsOn' || key === 'clock24h') {
      await get().refresh();
    }
    if (key === 'notificationsEnabled' && reminderBridge.available()) {
      if (value === false) {
        await reminderBridge.module().cancelAll().catch(() => undefined);
      } else {
        await get().syncDerived();
      }
    }
  },

  /* ---------------------------------- events --------------------------------- */

  saveEvent: async (input, id) => {
    const db = requireDb(get().db);
    const saved = id ? await updateEvent(db, id, input) : await createEvent(db, input);
    await get().refresh();
    await get().syncDerived();
    if (input.attendees && input.attendees.length > 0) {
      // Attendees are local text only; nothing is sent anywhere.
    }
    return saved;
  },

  patchEvent: async (id, patch) => {
    const db = requireDb(get().db);
    await updateEvent(db, id, patch);
    await get().refresh();
    await get().syncDerived();
  },

  removeEvent: async (id, scope, occurrenceStart) => {
    const db = requireDb(get().db);
    const result = await deleteEvent(db, id, {scope, occurrenceStart});
    await recordUndo(db, 'Deleted event', {restore: [{table: 'events', ids: result.deletedIds}]});
    set({undo: await latestUndo(db)});
    await get().refresh();
    await get().syncDerived();
  },

  /* ----------------------------------- tasks --------------------------------- */

  saveTask: async (input, id) => {
    const db = requireDb(get().db);
    const saved = id ? await updateTask(db, id, input) : await createTask(db, input);
    await get().refresh();
    await get().syncDerived();
    return saved;
  },

  toggleTask: async task => {
    const db = requireDb(get().db);
    if (task.completedAt) {
      await reopenTask(db, task.id);
    } else {
      await completeTask(db, task.id);
    }
    await get().refresh();
    await get().syncDerived();
  },

  removeTask: async id => {
    const db = requireDb(get().db);
    const ids = await deleteTask(db, id);
    await recordUndo(db, 'Deleted task', {restore: [{table: 'tasks', ids}]});
    set({undo: await latestUndo(db)});
    await get().refresh();
    await get().syncDerived();
  },

  /* ----------------------------------- notes --------------------------------- */

  saveNote: async (input, id) => {
    const db = requireDb(get().db);
    const saved = id ? await updateNote(db, id, input) : await createNote(db, input);
    await get().refresh();
    return saved;
  },

  removeNote: async id => {
    const db = requireDb(get().db);
    const ids = await deleteNoteRepo(db, id);
    await recordUndo(db, 'Deleted note', {restore: [{table: 'notes', ids}]});
    set({undo: await latestUndo(db)});
    await get().refresh();
  },

  togglePin: async note => {
    const db = requireDb(get().db);
    await updateNote(db, note.id, {pinned: !note.pinned});
    await get().refresh();
  },

  createNotebook: async name => {
    const db = requireDb(get().db);
    const {createNotebook: create} = await import('../repos/notes');
    await create(db, name);
    await get().refresh();
  },

  /* ---------------------------------- habits --------------------------------- */

  addHabit: async input => {
    const db = requireDb(get().db);
    await createHabit(db, input);
    await get().refresh();
  },

  toggleHabit: async (habitId, dateKey) => {
    const db = requireDb(get().db);
    const snapshot = get().snapshot;
    const done = Boolean(
      snapshot?.habitLogs.some(log => log.habitId === habitId && log.date === dateKey),
    );
    await setHabitLog(db, habitId, dateKey, !done);
    await get().refresh();
  },

  archiveHabit: async habitId => {
    const db = requireDb(get().db);
    await updateHabit(db, habitId, {archived: true});
    await get().refresh();
  },

  toggleRoutineItem: async (routineId, item, done) => {
    const db = requireDb(get().db);
    const snapshot = get().snapshot;
    const todayKey = snapshot?.todayKey ?? localDateKey(Date.now(), get().settings.calendarTimeZone);
    const current = snapshot?.routineLogs.find(log => log.routineId === routineId)?.completedItems ?? [];
    const next = done ? [...new Set([...current, item])] : current.filter(entry => entry !== item);
    await setRoutineLog(db, routineId, todayKey, next);
    await get().refresh();
  },

  setRoutineEnabled: async (routineId, enabled) => {
    const db = requireDb(get().db);
    await updateRoutine(db, routineId, {enabled});
    await get().refresh();
  },

  /* --------------------------------- planning -------------------------------- */

  addProject: async name => {
    const db = requireDb(get().db);
    const {createProject} = await import('../repos/planning');
    await createProject(db, name);
    await get().refresh();
  },

  addGoal: async (title, target, unit) => {
    const db = requireDb(get().db);
    await createGoal(db, {title, target, metricUnit: unit});
    await get().refresh();
  },

  bumpGoal: async (goal, delta) => {
    const db = requireDb(get().db);
    const current = Math.max(0, goal.current + delta);
    await updateGoal(db, goal.id, {
      current,
      status: current >= goal.target ? 'done' : 'active',
    });
    await get().refresh();
  },

  saveMood: async (mood, energy) => {
    const db = requireDb(get().db);
    const todayKey = get().snapshot?.todayKey ?? localDateKey(Date.now(), get().settings.calendarTimeZone);
    await setMoodRepo(db, todayKey, mood, energy);
    await get().refresh();
  },

  saveIntention: async text => {
    const db = requireDb(get().db);
    const todayKey = get().snapshot?.todayKey ?? localDateKey(Date.now(), get().settings.calendarTimeZone);
    await setIntentionRepo(db, todayKey, text);
    await get().refresh();
  },

  saveReflection: async fields => {
    const db = requireDb(get().db);
    const todayKey = get().snapshot?.todayKey ?? localDateKey(Date.now(), get().settings.calendarTimeZone);
    await saveReflectionRepo(db, weekStartKey(todayKey), fields);
    await get().refresh();
  },

  addReminder: async (title, triggerAt) => {
    const db = requireDb(get().db);
    await createReminder(db, {kind: 'custom', title, triggerAt});
    if (reminderBridge.available() && get().settings.notificationsEnabled) {
      await reminderBridge.module().requestPermission().catch(() => false);
    }
    await get().refresh();
    await get().syncDerived();
  },

  dismissReminder: async id => {
    const db = requireDb(get().db);
    await dismissReminderRepo(db, id);
    if (reminderBridge.available()) {
      await reminderBridge.module().cancel(id).catch(() => undefined);
    }
    await get().refresh();
    await get().syncDerived();
  },

  /* ----------------------------------- focus ---------------------------------- */

  beginFocus: async (minutes, label, kind, taskId) => {
    const db = requireDb(get().db);
    const existing = await activeSession(db);
    if (existing) {
      await endSession(db, existing.id, false);
    }
    const session = await startSession(db, {
      label,
      plannedMinutes: minutes,
      kind,
      taskId,
    });
    await get().refresh();
    return session;
  },

  finishFocus: async completed => {
    const db = requireDb(get().db);
    const active = await activeSession(db);
    if (!active) {
      return;
    }
    const finished = await endSession(db, active.id, completed);
    if (finished.kind === 'focus' && finished.endedAt) {
      const {addTimeEntry} = await import('../repos/focus');
      await addTimeEntry(db, {
        label: finished.label,
        category: 'focus',
        startedAt: finished.startedAt,
        endedAt: finished.endedAt,
        source: 'focus',
      });
    }
    await get().refresh();
  },

  logTime: async (label, minutes, category) => {
    const db = requireDb(get().db);
    const {addTimeEntry} = await import('../repos/focus');
    const endedAt = Date.now();
    await addTimeEntry(db, {
      label,
      category,
      startedAt: endedAt - minutes * 60_000,
      endedAt,
    });
    await get().refresh();
  },

  /* ---------------------------------- widgets --------------------------------- */

  reorderWidgets: async placements => {
    const db = requireDb(get().db);
    await saveWidgetLayout(db, placements);
    await get().refresh();
  },

  addWidget: async (kind, span) => {
    const snapshot = get().snapshot;
    if (!snapshot) {
      return;
    }
    const placements = snapshot.widgets.map(w => ({kind: w.kind, span: w.span, config: w.config}));
    placements.push({kind, span, config: {}});
    await get().reorderWidgets(placements);
  },

  removeWidget: async id => {
    const snapshot = get().snapshot;
    if (!snapshot) {
      return;
    }
    const placements = snapshot.widgets
      .filter(w => w.id !== id)
      .map(w => ({kind: w.kind, span: w.span, config: w.config}));
    await get().reorderWidgets(placements);
  },

  configureWidget: async (id, config) => {
    const db = requireDb(get().db);
    await updateWidgetConfig(db, id, config);
    await get().refresh();
  },

  resetWidgets: async () => {
    const db = requireDb(get().db);
    await resetWidgetLayout(db);
    await get().refresh();
  },

  /* ---------------------------------- models ---------------------------------- */

  refreshModels: async () => {
    const {db, modelManager} = get();
    if (!db || !modelManager) {
      return;
    }
    const modelStates = await modelManager.states();
    set(state => ({
      snapshot: state.snapshot ? {...state.snapshot, modelStates} : state.snapshot,
    }));
  },

  installBundledModels: async () => {
    const manager = get().modelManager;
    if (!manager) {
      return;
    }
    await manager.ensureBundled();
    await get().refreshModels();
  },

  downloadModel: async id => {
    const manager = requireModelManager(get().modelManager);
    set({busy: `Downloading ${id}`});
    try {
      await manager.download(id, (progress: DownloadProgress) => {
        set(state => ({
          modelProgress: {
            ...state.modelProgress,
            [id]: progress.totalBytes === 0 ? 0 : progress.receivedBytes / progress.totalBytes,
          },
        }));
      });
      set(state => {
        const next = {...state.modelProgress};
        delete next[id];
        return {modelProgress: next};
      });
      if (isLlm(id)) {
        set({llmModelId: id});
      }
      await get().refreshModels();
      set({notice: {kind: 'success', message: 'Model installed and checksum-verified.'}});
    } catch (error) {
      await get().refreshModels();
      set({
        notice: {
          kind: 'error',
          message: error instanceof ModelError ? error.message : 'The download failed.',
        },
      });
    } finally {
      set({busy: null});
    }
  },

  deleteModel: async id => {
    const manager = requireModelManager(get().modelManager);
    await releaseWhisper();
    await manager.remove(id);
    const llm = get().llmModelId;
    if (llm === id) {
      set({llmModelId: null});
    }
    await get().refreshModels();
  },

  verifyModel: async id => {
    const manager = requireModelManager(get().modelManager);
    try {
      const state = await manager.verify(id);
      set({
        notice: {
          kind: state.status === 'installed' ? 'success' : 'error',
          message:
            state.status === 'installed'
              ? 'Checksum matches the pinned manifest.'
              : (state.message ?? 'Verification failed.'),
        },
      });
    } catch (error) {
      set({notice: {kind: 'error', message: error instanceof Error ? error.message : 'Verification failed.'}});
    }
    await get().refreshModels();
  },

  /* --------------------------------- assistant -------------------------------- */

  planText: async text => {
    const {db, settings} = get();
    if (!db) {
      return null;
    }
    const command = text.trim();
    if (command === '') {
      set({
        notice: {kind: 'info', message: 'Type or say a command first.'},
        lastPlan: null,
      });
      return null;
    }
    const manager = get().modelManager;
    const llmId = get().llmModelId;
    const llm = manager && llmId ? new LlamaLocalLlm(manager, llmId) : undefined;
    const now = Date.now();
    const state = get().snapshot;
    const ctx = {
      db,
      settings,
      now,
      timeZone: settings.calendarTimeZone,
      defaultEventMinutes: settings.defaultEventMinutes,
      clock24h: settings.clock24h,
      workdayStart: settings.workdayStart,
      workdayEnd: settings.workdayEnd,
      events: state?.events ?? [],
      tasks: state?.tasks ?? [],
      habits: state?.habits.filter(habit => !habit.archived) ?? [],
      projects: state?.projects ?? [],
    };
    set({busy: 'Planning', lastOutcome: null});
    try {
      const response = await planAssistantCommand(command, ctx, {llm});
      set({lastPlan: response, busy: null});
      // Commands include voice transcripts. Keep neither command text nor
      // transcript in SQLite unless the user explicitly enabled retention.
      if (settings.retainTranscripts) {
        await logAssistantTurn(db, {
          input: command,
          transcript: get().transcript,
          plan: response.planning.kind === 'plan' ? response.planning.plan.interpretation : response.planning.kind,
          status: response.planning.kind,
        }).catch(() => undefined);
      }
      return response;
    } catch (error) {
      set({
        busy: null,
        notice: {
          kind: 'error',
          message: error instanceof Error ? error.message : 'The command could not be planned.',
        },
      });
      return null;
    }
  },

  confirmPlan: async plan => {
    const {db, settings} = get();
    if (!db) {
      return null;
    }
    const outcome = await executePlan(plan, {
      db,
      timeZone: settings.calendarTimeZone,
      clock24h: settings.clock24h,
      workdayStart: settings.workdayStart,
      workdayEnd: settings.workdayEnd,
      afterChange: () => get().syncDerived(),
    });
    set({lastOutcome: outcome, lastPlan: null});
    await get().refresh();
    await get().syncDerived();
    if (outcome.undoToken) {
      set({undo: await latestUndo(db)});
    }
    return outcome;
  },

  clearPlan: () => set({lastPlan: null, lastOutcome: null, transcript: null}),

  startVoice: async () => {
    const manager = requireModelManager(get().modelManager);
    try {
      if (!(await speechReady(manager))) {
        throw new Error('The speech model is not installed yet. Check AI Models in Settings.');
      }
      await startRecording();
      set({recording: true, transcript: null, notice: null});
    } catch (error) {
      set({
        recording: false,
        notice: {kind: 'error', message: error instanceof Error ? error.message : 'Recording failed.'},
      });
    }
  },

  stopVoice: async () => {
    const manager = get().modelManager;
    if (!manager) {
      return;
    }
    set({recording: false, busy: 'Transcribing'});
    let path: string | null = null;
    try {
      const recording = await stopRecording();
      path = recording.path;
      const result = await transcribe(manager, recording.path);
      const text = result.text.trim();
      set({transcript: text, busy: null, notice: null});
      if (text === '') {
        set({notice: {kind: 'info', message: 'I did not catch a command. Try again.'}});
        return;
      }
      await get().planText(text);
    } catch (error) {
      set({
        busy: null,
        notice: {kind: 'error', message: error instanceof Error ? error.message : 'Transcription failed.'},
      });
    } finally {
      // Recordings are deleted unless the user opted into retaining transcripts
      // (the audio itself is never kept).
      if (path && modelsSupported()) {
        const {modelStore} = await import('../native/index');
        await modelStore.module().deleteFile(path).catch(() => undefined);
      }
    }
  },

  undoLast: async () => {
    const {db, undo} = get();
    if (!db || !undo) {
      return;
    }
    const restored = await applyUndo(db, undo.token);
    set({
      undo: await latestUndo(db),
      notice: restored
        ? {kind: 'success', message: 'Restored.'}
        : {kind: 'error', message: 'That change can no longer be undone.'},
    });
    await get().refresh();
    await get().syncDerived();
  },

  search: async query => {
    const db = get().db;
    if (!db) {
      return [];
    }
    return searchRepo(db, query);
  },
}));

function isLlm(id: string): boolean {
  return id.includes('llama') || id.includes('phi') || id.includes('gemma');
}

function requireDb(db: SqlDriver | null): SqlDriver {
  if (!db) {
    throw new Error('The local database is not open yet.');
  }
  return db;
}

function requireModelManager(manager: ModelManager | null): ModelManager {
  if (!manager) {
    throw new Error('Model downloads are not available in this build.');
  }
  return manager;
}

