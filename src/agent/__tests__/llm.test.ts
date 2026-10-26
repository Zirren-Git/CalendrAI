import {NodeSqliteDriver} from '../../db/nodeDriver';
import {initializeDatabase} from '../../db';
import {listAllEvents} from '../../repos/events';
import {listTasks, createTask} from '../../repos/tasks';
import {listHabits} from '../../repos/habits';
import {listProjects} from '../../repos/planning';
import {DEFAULT_SETTINGS} from '../../repos/system';
import {wallClockToUtc} from '../../domain/time';
import {buildCommandPrompt, extractJsonObject, planWithLlm, type LocalLlm} from '../llm';
import {planAssistantCommand, runAssistantCommand, type AssistantContext} from '../assistant';
import type {Plan} from '../types';

const TZ = 'America/New_York';
const NOW = wallClockToUtc({year: 2026, month: 5, day: 4, hour: 10, minute: 0}, TZ);

async function setup() {
  const db = new NodeSqliteDriver();
  await initializeDatabase(db);
  await createTask(db, {title: 'Buy paint'});
  const ctx: AssistantContext = {
    db,
    now: NOW,
    timeZone: TZ,
    defaultEventMinutes: 60,
    clock24h: false,
    workdayStart: 9 * 60,
    workdayEnd: 18 * 60,
    events: await listAllEvents(db),
    tasks: await listTasks(db),
    habits: await listHabits(db),
    projects: await listProjects(db),
    settings: {...DEFAULT_SETTINGS, autoExecuteSafeCommands: false},
  };
  return {db, ctx};
}

function fakeLlm(payload: string, ready = true): LocalLlm {
  const calls: string[] = [];
  return {
    isReady: async () => ready,
    generate: async request => {
      calls.push(request.prompt);
      return {text: payload};
    },
  };
}

describe('extractJsonObject', () => {
  it('extracts JSON surrounded by prose', () => {
    const raw = 'Sure! {"a":1,"b":{"c":"}"}} hope that helps';
    expect(extractJsonObject(raw)).toEqual({a: 1, b: {c: '}'}});
  });

  it('returns null for malformed output', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{"a": }')).toBeNull();
  });
});

describe('buildCommandPrompt', () => {
  it('includes the clock, zone and known ids but no private note content', async () => {
    const {db, ctx} = await setup();
    await db.run('INSERT INTO notes (id,title,body,tags,pinned,created_at,updated_at) VALUES (?,?,?,?,0,?,?)', [
      'note-1',
      'Therapy notes',
      'very private body text',
      '[]',
      1,
      1,
    ]);
    const prompt = buildCommandPrompt('buy milk', ctx);
    expect(prompt).toContain('America/New_York');
    expect(prompt).toContain(String(NOW));
    expect(prompt).toContain(ctx.tasks[0]!.id);
    expect(prompt).not.toContain('very private body text');
    db.close();
  });
});

describe('planWithLlm', () => {
  it('accepts a valid plan and marks its source', async () => {
    const {db, ctx} = await setup();
    const llm = fakeLlm(
      JSON.stringify({
        interpretation: 'Add a task to buy milk',
        confidence: 0.82,
        clarification: null,
        actions: [{type: 'create_task', title: 'Buy milk', priority: 1}],
      }),
    );
    const plan = await planWithLlm(llm, 'buy milk', ctx);
    expect(plan).not.toBeNull();
    expect(plan!.source).toBe('llm');
    expect(plan!.actions[0]!.action.type).toBe('create_task');
    db.close();
  });

  it('forces confirmation on destructive model output', async () => {
    const {db, ctx} = await setup();
    const taskId = ctx.tasks[0]!.id;
    const llm = fakeLlm(
      JSON.stringify({
        interpretation: 'Delete the task',
        confidence: 0.99,
        actions: [{type: 'delete_task', taskId}],
      }),
    );
    const plan = await planWithLlm(llm, 'delete buy paint', ctx);
    expect(plan).not.toBeNull();
    expect(plan!.actions[0]!.requiresConfirmation).toBe(true);
    db.close();
  });

  it('rejects unknown action types and malformed payloads', async () => {
    const {db, ctx} = await setup();
    const unknown = await planWithLlm(
      fakeLlm(JSON.stringify({interpretation: 'x', confidence: 1, actions: [{type: 'run_sql', sql: 'DROP TABLE tasks'}]})),
      'drop everything',
      ctx,
    );
    expect(unknown).toBeNull();
    const garbage = await planWithLlm(fakeLlm('I think you should buy milk.'), 'buy milk', ctx);
    expect(garbage).toBeNull();
    const outOfRange = await planWithLlm(
      fakeLlm(JSON.stringify({interpretation: 'x', confidence: 1, actions: [{type: 'start_timer', minutes: 99999}]})),
      'timer',
      ctx,
    );
    expect(outOfRange).toBeNull();
    db.close();
  });

  it('refuses to run when the model is not installed', async () => {
    const {db, ctx} = await setup();
    const plan = await planWithLlm(fakeLlm('{}', false), 'buy milk', ctx);
    expect(plan).toBeNull();
    db.close();
  });
});

describe('assistant orchestration', () => {
  it('uses the local model only when the deterministic parser is unsure', async () => {
    const {db, ctx} = await setup();
    const llm = fakeLlm(
      JSON.stringify({
        interpretation: 'Add a task to buy milk',
        confidence: 0.8,
        actions: [{type: 'create_task', title: 'Buy milk'}],
      }),
    );
    const unsure = await planAssistantCommand('buy milk', ctx, {llm});
    expect(unsure.usedLlm).toBe(true);

    const confident = await planAssistantCommand('add task buy paint tomorrow', ctx, {llm});
    expect(confident.usedLlm).toBe(false);
    expect(confident.planning.kind).toBe('plan');
    db.close();
  });

  it('falls back to the built-in parser when the model output is unusable', async () => {
    const {db, ctx} = await setup();
    const response = await planAssistantCommand('buy milk', ctx, {llm: fakeLlm('not json')});
    expect(response.usedLlm).toBe(false);
    expect(response.note).toMatch(/built-in parser/);
    db.close();
  });

  it('auto-executes safe queries only when the user opted in', async () => {
    const {db, ctx} = await setup();
    const off = await runAssistantCommand('what is on my calendar today', ctx, {});
    expect(off.autoExecuted).toBe(false);
    expect(off.outcome).toBeNull();

    const on = {...ctx, settings: {...ctx.settings, autoExecuteSafeCommands: true}};
    const response = await runAssistantCommand('what is on my calendar today', on, {});
    expect(response.autoExecuted).toBe(true);
    expect(response.outcome!.allSucceeded).toBe(true);
    db.close();
  });

  it('never auto-executes a write', async () => {
    const {db, ctx} = await setup();
    const on = {...ctx, settings: {...ctx.settings, autoExecuteSafeCommands: true}};
    const response = await runAssistantCommand('add standup tomorrow at 9am', on, {});
    expect(response.autoExecuted).toBe(false);
    const events = await listAllEvents(db);
    expect(events).toHaveLength(0);
    db.close();
  });
});
