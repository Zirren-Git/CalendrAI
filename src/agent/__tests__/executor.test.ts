import {NodeSqliteDriver} from '../../db/nodeDriver';
import {initializeDatabase} from '../../db';
import {createEvent, listAllEvents, listOccurrences} from '../../repos/events';
import {createTask, listTasks, getTask} from '../../repos/tasks';
import {createHabit, listHabits, listHabitLogs} from '../../repos/habits';
import {listProjects} from '../../repos/planning';
import {activeSession} from '../../repos/focus';
import {applyUndo} from '../../repos/system';
import {localDateKey, wallClockToUtc} from '../../domain/time';
import {planCommand, type PlannerContext} from '../planner';
import {executePlan, type AgentDeps} from '../executor';
import type {Plan} from '../types';

const TZ = 'America/New_York';

async function setup() {
  const db = new NodeSqliteDriver();
  await initializeDatabase(db);
  await createHabit(db, {name: 'Meditation'});
  await createTask(db, {title: 'Buy paint'});
  const start = wallClockToUtc({year: 2026, month: 5, day: 4, hour: 9, minute: 0}, TZ);
  await createEvent(db, {
    title: 'Standup',
    start,
    end: start + 15 * 60_000,
    timezone: TZ,
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
  });
  const ctx: PlannerContext = {
    now: wallClockToUtc({year: 2026, month: 5, day: 4, hour: 10, minute: 0}, TZ),
    timeZone: TZ,
    defaultEventMinutes: 60,
    clock24h: false,
    events: await listAllEvents(db),
    tasks: await listTasks(db),
    habits: await listHabits(db),
    projects: await listProjects(db),
  };
  let changes = 0;
  const deps: AgentDeps = {
    db,
    timeZone: TZ,
    clock24h: false,
    workdayStart: 9 * 60,
    workdayEnd: 18 * 60,
    now: () => ctx.now,
    afterChange: () => {
      changes += 1;
    },
  };
  return {db, ctx, deps, changes: () => changes};
}

async function run(text: string, ctx: PlannerContext, deps: AgentDeps) {
  const planning = planCommand(text, ctx);
  if (planning.kind !== 'plan') {
    throw new Error(`Expected plan, got ${planning.kind}`);
  }
  const outcome = await executePlan(planning.plan, deps);
  return {plan: planning.plan, outcome};
}

describe('executePlan — writes', () => {
  it('creates an event with a reminder', async () => {
    const {db, ctx, deps, changes} = await setup();
    const {outcome} = await run('add standup tomorrow at 9am', ctx, deps);
    expect(outcome.allSucceeded).toBe(true);
    const events = (await listAllEvents(db)).filter(event => event.title === 'Standup');
    expect(events.length).toBeGreaterThanOrEqual(2);
    const reminders = await db.all('SELECT * FROM reminders WHERE kind = ?', ['event']);
    expect(reminders.length).toBe(1);
    expect(changes()).toBe(1);
    db.close();
  });

  it('completes a task', async () => {
    const {db, ctx, deps} = await setup();
    const {outcome} = await run('complete task buy paint', ctx, deps);
    expect(outcome.allSucceeded).toBe(true);
    const tasks = await listTasks(db, {includeCompleted: true});
    expect(tasks.find(task => task.title === 'Buy paint')?.completedAt).not.toBeNull();
    db.close();
  });

  it('creates a project on demand for a task', async () => {
    const {db, ctx, deps} = await setup();
    await run('add task buy brushes in the Home project', ctx, deps);
    const projects = await listProjects(db);
    expect(projects.map(project => project.name)).toContain('Home');
    db.close();
  });

  it('logs a habit', async () => {
    const {db, ctx, deps} = await setup();
    const {outcome} = await run('log meditation', ctx, deps);
    expect(outcome.allSucceeded).toBe(true);
    const logs = await listHabitLogs(db, '2026-05-04', '2026-05-04');
    expect(logs).toHaveLength(1);
    db.close();
  });

  it('starts a focus session and closes any previous one', async () => {
    const {db, ctx, deps} = await setup();
    await run('start a pomodoro for 50 minutes', ctx, deps);
    const session = await activeSession(db);
    expect(session).not.toBeNull();
    expect(session!.plannedMinutes).toBe(50);
    await run('start a 10 minute timer', ctx, deps);
    const active = await activeSession(db);
    expect(active!.plannedMinutes).toBe(10);
    db.close();
  });

  it('creates a note', async () => {
    const {db, ctx, deps} = await setup();
    const {outcome} = await run('note the spare key is with the neighbour', ctx, deps);
    expect(outcome.allSucceeded).toBe(true);
    const notes = await db.all('SELECT * FROM notes WHERE deleted_at IS NULL');
    expect(notes).toHaveLength(1);
    db.close();
  });
});

describe('executePlan — deletes and undo', () => {
  it('soft deletes an occurrence like the UI does', async () => {
    const {db, ctx, deps} = await setup();
    const {outcome} = await run('delete standup', ctx, deps);
    expect(outcome.allSucceeded).toBe(true);
    const occurrences = await listOccurrences(
      db,
      wallClockToUtc({year: 2026, month: 5, day: 1, hour: 0, minute: 0}, TZ),
      wallClockToUtc({year: 2026, month: 5, day: 31, hour: 0, minute: 0}, TZ),
    );
    // Only this week's instance is cancelled; the series continues.
    expect(occurrences).toHaveLength(3);
    expect(occurrences.some(o => localDateKey(o.start, TZ) === '2026-05-04')).toBe(false);
    db.close();
  });

  it('records an undo token for task deletion that restores the task', async () => {
    const {db, ctx, deps} = await setup();
    const {outcome} = await run('delete task buy paint', ctx, deps);
    expect(outcome.undoToken).toBeTruthy();
    expect(await listTasks(db, {includeCompleted: true})).toHaveLength(0);
    expect(await applyUndo(db, outcome.undoToken!)).toBe(true);
    expect(await listTasks(db, {includeCompleted: true})).toHaveLength(1);
    db.close();
  });
});

describe('executePlan — queries', () => {
  it('answers from local data only', async () => {
    const {db, ctx, deps} = await setup();
    const {outcome} = await run('what is on my calendar today', ctx, deps);
    const result = outcome.results[0]!;
    expect(result.ok).toBe(true);
    expect(result.answer).toContain('Standup');
    db.close();
  });

  it('finds free time within working hours', async () => {
    const {db, ctx, deps} = await setup();
    const {outcome} = await run('find 30 minutes free today', ctx, deps);
    const answer = outcome.results[0]!.answer ?? '';
    expect(answer).toMatch(/\d+ min/);
    db.close();
  });
});

describe('executePlan — failure reporting', () => {
  it('reports partial success instead of claiming the whole plan worked', async () => {
    const {db, ctx, deps} = await setup();
    const plan: Plan = {
      id: 'partial',
      interpretation: 'Mixed plan',
      confidence: 0.9,
      source: 'deterministic',
      actions: [
        {
          id: 'a1',
          action: {type: 'complete_task', taskId: 'missing-task'},
          summary: 'Complete missing',
          confidence: 0.9,
          requiresConfirmation: false,
        },
        {
          id: 'a2',
          action: {type: 'create_note', title: 'Still works', body: ''},
          summary: 'Create note',
          confidence: 0.9,
          requiresConfirmation: false,
        },
      ],
      clarification: null,
    };
    const outcome = await executePlan(plan, deps);
    expect(outcome.succeeded).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.allSucceeded).toBe(false);
    expect(outcome.results[0]!.ok).toBe(false);
    expect(outcome.results[1]!.ok).toBe(true);
    const notes = await db.all('SELECT * FROM notes WHERE deleted_at IS NULL');
    expect(notes).toHaveLength(1);
    // Unrelated context not touched by the failing action.
    expect((await getTask(db, 'missing-task'))).toBeNull();
    db.close();
  });

  it('rejects a plan whose destructive action skips confirmation', async () => {
    const {db, deps} = await setup();
    const plan = {
      id: 'bad',
      interpretation: 'bad',
      confidence: 0.9,
      source: 'deterministic' as const,
      actions: [
        {
          id: 'a1',
          action: {type: 'delete_task', taskId: 'x'},
          summary: 'Delete',
          confidence: 0.9,
          requiresConfirmation: false,
        },
      ],
      clarification: null,
    };
    await expect(executePlan(plan as Plan, deps)).rejects.toThrow(/must require confirmation/);
    db.close();
  });
});
