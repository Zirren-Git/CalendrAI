import {NodeSqliteDriver} from '../../db/nodeDriver';
import {initializeDatabase} from '../../db';
import {createEvent, listAllEvents} from '../../repos/events';
import {createTask, listTasks} from '../../repos/tasks';
import {createHabit, listHabits} from '../../repos/habits';
import {createProject, listProjects} from '../../repos/projects-helper';
import {wallClockToUtc} from '../../domain/time';
import {planCommand, type PlannerContext, type PlanningResult} from '../planner';

const TZ = 'America/New_York';

async function setup() {
  const db = new NodeSqliteDriver();
  await initializeDatabase(db);
  await createHabit(db, {name: 'Meditation', emoji: '🧘'});
  await createProject(db, 'Home');
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
  return {db, ctx};
}

function expectPlan(result: PlanningResult) {
  if (result.kind !== 'plan') {
    throw new Error(`Expected a plan, got ${result.kind}: ${JSON.stringify(result)}`);
  }
  return result.plan;
}

describe('planCommand — creation', () => {
  it('plans an event from natural language', async () => {
    const {db, ctx} = await setup();
    const plan = expectPlan(planCommand('add standup tomorrow at 9am', ctx));
    const action = plan.actions[0]!.action;
    expect(action.type).toBe('create_event');
    if (action.type !== 'create_event') {
      throw new Error('wrong action');
    }
    expect(action.title).toBe('Standup');
    expect(action.start).toBe(wallClockToUtc({year: 2026, month: 5, day: 5, hour: 9, minute: 0}, TZ));
    expect(action.end - action.start).toBe(60 * 60_000);
    expect(plan.actions[0]!.requiresConfirmation).toBe(false);
    db.close();
  });

  it('plans a task and extracts a project', async () => {
    const {db, ctx} = await setup();
    const plan = expectPlan(planCommand('add task buy brushes to Home', ctx));
    const action = plan.actions[0]!.action;
    expect(action.type).toBe('create_task');
    if (action.type !== 'create_task') {
      throw new Error('wrong action');
    }
    expect(action.title).toBe('Buy brushes');
    expect(action.projectName).toBe('Home');
    db.close();
  });

  it('plans a note', async () => {
    const {db, ctx} = await setup();
    const plan = expectPlan(planCommand('note the wifi password is on the fridge', ctx));
    expect(plan.actions[0]!.action.type).toBe('create_note');
    db.close();
  });

  it('plans a reminder with a future trigger', async () => {
    const {db, ctx} = await setup();
    const plan = expectPlan(planCommand('remind me to call alex in 10 minutes', ctx));
    const action = plan.actions[0]!.action;
    expect(action.type).toBe('set_reminder');
    if (action.type !== 'set_reminder') {
      throw new Error('wrong action');
    }
    expect(action.triggerAt).toBe(ctx.now + 10 * 60_000);
    expect(action.title.toLowerCase()).toContain('call alex');
    db.close();
  });

  it('plans a focus session with a custom length', async () => {
    const {db, ctx} = await setup();
    const plan = expectPlan(planCommand('start a pomodoro for 50 minutes', ctx));
    const action = plan.actions[0]!.action;
    expect(action.type).toBe('start_pomodoro');
    if (action.type !== 'start_pomodoro') {
      throw new Error('wrong action');
    }
    expect(action.minutes).toBe(50);
    db.close();
  });
});

describe('planCommand — matching existing records', () => {
  it('completes an existing task', async () => {
    const {db, ctx} = await setup();
    const plan = expectPlan(planCommand('complete task buy paint', ctx));
    const action = plan.actions[0]!.action;
    expect(action.type).toBe('complete_task');
    db.close();
  });

  it('requires confirmation to delete a recurring event and scopes it to one occurrence', async () => {
    const {db, ctx} = await setup();
    const plan = expectPlan(planCommand('delete standup', ctx));
    const entry = plan.actions[0]!;
    expect(entry.action.type).toBe('delete_event');
    if (entry.action.type !== 'delete_event') {
      throw new Error('wrong action');
    }
    expect(entry.action.scope).toBe('occurrence');
    expect(entry.requiresConfirmation).toBe(true);
    db.close();
  });

  it('logs a habit by name', async () => {
    const {db, ctx} = await setup();
    const plan = expectPlan(planCommand('log meditation', ctx));
    const action = plan.actions[0]!.action;
    expect(action.type).toBe('log_habit');
    if (action.type !== 'log_habit') {
      throw new Error('wrong action');
    }
    expect(action.habitId).not.toBeNull();
    expect(action.date).toBe('2026-05-04');
    db.close();
  });
});

describe('planCommand — queries and navigation', () => {
  it('answers schedule questions with that day’s range', async () => {
    const {db, ctx} = await setup();
    const plan = expectPlan(planCommand('what’s on my calendar today', ctx));
    const action = plan.actions[0]!.action;
    expect(action.type).toBe('query_schedule');
    if (action.type !== 'query_schedule') {
      throw new Error('wrong action');
    }
    expect(action.rangeEnd - action.rangeStart).toBe(86_400_000 - 1);
    db.close();
  });

  it('finds free time with the requested minimum', async () => {
    const {db, ctx} = await setup();
    const plan = expectPlan(planCommand('find 45 minutes free tomorrow', ctx));
    const action = plan.actions[0]!.action;
    expect(action.type).toBe('find_free_time');
    if (action.type !== 'find_free_time') {
      throw new Error('wrong action');
    }
    expect(action.minMinutes).toBe(45);
    db.close();
  });

  it('navigates', async () => {
    const {db, ctx} = await setup();
    const plan = expectPlan(planCommand('open notes', ctx));
    const action = plan.actions[0]!.action;
    expect(action.type).toBe('navigate');
    if (action.type !== 'navigate') {
      throw new Error('wrong action');
    }
    expect(action.screen).toBe('notes');
    db.close();
  });
});

describe('planCommand — clarification and refusal', () => {
  it('asks for a time when an event has none', async () => {
    const {db, ctx} = await setup();
    const result = planCommand('add a meeting', ctx);
    expect(result.kind).toBe('clarify');
    db.close();
  });

  it('asks which task to delete when nothing matches', async () => {
    const {db, ctx} = await setup();
    const result = planCommand('delete the quarterly report', ctx);
    expect(result.kind).toBe('clarify');
    db.close();
  });

  it('returns unknown for gibberish without inventing data', async () => {
    const {db, ctx} = await setup();
    const result = planCommand('zxcvbnm', ctx);
    expect(result.kind).toBe('unknown');
    db.close();
  });

  it('flags ambiguous dates for confirmation', async () => {
    const {db, ctx} = await setup();
    const result = planCommand('add review tomorrow and friday at 10am', ctx);
    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('expected plan');
    }
    expect(result.plan.clarification).toMatch(/more than one date/i);
    expect(result.plan.confidence).toBeLessThan(0.75);
    db.close();
  });
});
