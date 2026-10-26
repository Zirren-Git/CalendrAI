import type {SqlDriver} from '../db/driver';
import type {
  FavoriteAction,
  Goal,
  ID,
  Intention,
  MoodCheckin,
  Project,
  Reflection,
  Routine,
} from '../domain/types';
import {
  newId,
  toFavorite,
  toGoal,
  toIntention,
  toMood,
  toProject,
  toReflection,
  toRoutine,
} from './mappers';

/* ---------------------------------- projects --------------------------------- */

export async function listProjects(db: SqlDriver, includeArchived = false): Promise<Project[]> {
  const rows = await db.all(
    `SELECT * FROM projects ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name COLLATE NOCASE ASC`,
  );
  return rows.map(toProject);
}

export async function createProject(
  db: SqlDriver,
  name: string,
  color = '#6F7F63',
  now = Date.now(),
): Promise<Project> {
  if (!name.trim()) {
    throw new Error('Project name is required');
  }
  const id = newId('proj');
  await db.run('INSERT INTO projects (id, name, color, archived, created_at) VALUES (?,?,?,0,?)', [
    id,
    name.trim(),
    color,
    now,
  ]);
  const rows = await db.all('SELECT * FROM projects WHERE id = ?', [id]);
  return toProject(rows[0]!);
}

export async function updateProject(
  db: SqlDriver,
  id: ID,
  patch: {name?: string; color?: string; archived?: boolean},
): Promise<Project> {
  const rows = await db.all('SELECT * FROM projects WHERE id = ?', [id]);
  if (!rows[0]) {
    throw new Error('Project not found');
  }
  const current = toProject(rows[0]);
  const next = {...current, ...patch};
  await db.run('UPDATE projects SET name=?, color=?, archived=? WHERE id=?', [
    next.name.trim(),
    next.color,
    next.archived,
    id,
  ]);
  const updated = await db.all('SELECT * FROM projects WHERE id = ?', [id]);
  return toProject(updated[0]!);
}

export async function findProjectByName(db: SqlDriver, name: string): Promise<Project | null> {
  const rows = await db.all('SELECT * FROM projects WHERE name = ? COLLATE NOCASE AND archived = 0 LIMIT 1', [
    name,
  ]);
  return rows[0] ? toProject(rows[0]) : null;
}

/* ----------------------------------- goals ----------------------------------- */

export async function listGoals(db: SqlDriver, includeArchived = false): Promise<Goal[]> {
  const rows = await db.all(
    `SELECT * FROM goals ${includeArchived ? '' : "WHERE status = 'active'"} ORDER BY created_at DESC`,
  );
  return rows.map(toGoal);
}

export async function createGoal(
  db: SqlDriver,
  input: {title: string; target: number; current?: number; metricUnit?: string; dueDate?: string | null; description?: string | null},
  now = Date.now(),
): Promise<Goal> {
  if (!input.title.trim()) {
    throw new Error('Goal title is required');
  }
  if (!Number.isFinite(input.target) || input.target <= 0) {
    throw new Error('Goal target must be greater than zero');
  }
  const id = newId('goal');
  await db.run(
    `INSERT INTO goals (id, title, description, metric_unit, target, current, due_date, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,'active',?,?)`,
    [
      id,
      input.title.trim(),
      input.description ?? null,
      input.metricUnit ?? '',
      input.target,
      input.current ?? 0,
      input.dueDate ?? null,
      now,
      now,
    ],
  );
  const rows = await db.all('SELECT * FROM goals WHERE id = ?', [id]);
  return toGoal(rows[0]!);
}

export async function updateGoal(
  db: SqlDriver,
  id: ID,
  patch: {title?: string; current?: number; target?: number; status?: Goal['status']; dueDate?: string | null},
  now = Date.now(),
): Promise<Goal> {
  const rows = await db.all('SELECT * FROM goals WHERE id = ?', [id]);
  if (!rows[0]) {
    throw new Error('Goal not found');
  }
  const current = toGoal(rows[0]);
  const next = {...current, ...patch};
  await db.run(
    'UPDATE goals SET title=?, current=?, target=?, status=?, due_date=?, updated_at=? WHERE id=?',
    [next.title.trim(), next.current, next.target, next.status, next.dueDate, now, id],
  );
  const updated = await db.all('SELECT * FROM goals WHERE id = ?', [id]);
  return toGoal(updated[0]!);
}

/* ---------------------------------- routines --------------------------------- */

export async function listRoutines(db: SqlDriver): Promise<Routine[]> {
  const rows = await db.all('SELECT * FROM routines ORDER BY kind ASC, created_at ASC');
  return rows.map(toRoutine);
}

export async function ensureRoutines(db: SqlDriver, now = Date.now()): Promise<Routine[]> {
  const existing = await listRoutines(db);
  if (existing.length > 0) {
    return existing;
  }
  await db.transaction(async tx => {
    await tx.run(
      'INSERT INTO routines (id, kind, name, items, enabled, created_at) VALUES (?,?,?,?,1,?)',
      [
        newId('routine'),
        'morning',
        'Morning',
        JSON.stringify(['Review today’s plan', 'Pick one priority', 'Check calendar']),
        now,
      ],
    );
    await tx.run(
      'INSERT INTO routines (id, kind, name, items, enabled, created_at) VALUES (?,?,?,?,1,?)',
      [
        newId('routine'),
        'evening',
        'Evening',
        JSON.stringify(['Close open loops', 'Check tomorrow', 'Write a line of journal']),
        now,
      ],
    );
  });
  return listRoutines(db);
}

export async function updateRoutine(
  db: SqlDriver,
  id: ID,
  patch: {name?: string; items?: string[]; enabled?: boolean},
): Promise<Routine> {
  const rows = await db.all('SELECT * FROM routines WHERE id = ?', [id]);
  if (!rows[0]) {
    throw new Error('Routine not found');
  }
  const next = {...toRoutine(rows[0]), ...patch};
  await db.run('UPDATE routines SET name=?, items=?, enabled=? WHERE id=?', [
    next.name.trim(),
    JSON.stringify(next.items),
    next.enabled,
    id,
  ]);
  const updated = await db.all('SELECT * FROM routines WHERE id = ?', [id]);
  return toRoutine(updated[0]!);
}

export interface RoutineLog {
  id: string;
  routineId: string;
  date: string;
  completedItems: string[];
}

export async function setRoutineLog(
  db: SqlDriver,
  routineId: ID,
  date: string,
  completedItems: string[],
  now = Date.now(),
): Promise<void> {
  await db.run(
    `INSERT INTO routine_logs (id, routine_id, date, completed_items, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(routine_id, date) DO UPDATE SET completed_items = excluded.completed_items`,
    [newId('rlog'), routineId, date, JSON.stringify(completedItems), now],
  );
}

export async function routineLogs(db: SqlDriver, date: string): Promise<RoutineLog[]> {
  const rows = await db.all('SELECT * FROM routine_logs WHERE date = ?', [date]);
  return rows.map(row => {
    let completed: string[] = [];
    try {
      const parsed: unknown = JSON.parse(String(row.completed_items ?? '[]'));
      if (Array.isArray(parsed)) {
        completed = parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      completed = [];
    }
    return {
      id: String(row.id),
      routineId: String(row.routine_id),
      date: String(row.date),
      completedItems: completed,
    };
  });
}

/* ------------------------------ mood & planning ------------------------------ */

export async function getMood(db: SqlDriver, date: string): Promise<MoodCheckin | null> {
  const rows = await db.all('SELECT * FROM mood_checkins WHERE date = ?', [date]);
  return rows[0] ? toMood(rows[0]) : null;
}

export async function setMood(
  db: SqlDriver,
  date: string,
  mood: number,
  energy: number,
  note: string | null = null,
  now = Date.now(),
): Promise<MoodCheckin> {
  const clamp = (value: number) => Math.max(1, Math.min(5, Math.round(value)));
  await db.run(
    `INSERT INTO mood_checkins (id, date, mood, energy, note, created_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(date) DO UPDATE SET mood = excluded.mood, energy = excluded.energy, note = excluded.note`,
    [newId('mood'), date, clamp(mood), clamp(energy), note, now],
  );
  const rows = await db.all('SELECT * FROM mood_checkins WHERE date = ?', [date]);
  return toMood(rows[0]!);
}

export async function recentMoods(db: SqlDriver, limit = 30): Promise<MoodCheckin[]> {
  const rows = await db.all('SELECT * FROM mood_checkins ORDER BY date DESC LIMIT ?', [limit]);
  return rows.map(toMood);
}

export async function getIntention(db: SqlDriver, date: string): Promise<Intention | null> {
  const rows = await db.all('SELECT * FROM intentions WHERE date = ?', [date]);
  return rows[0] ? toIntention(rows[0]) : null;
}

export async function setIntention(
  db: SqlDriver,
  date: string,
  text: string,
  now = Date.now(),
): Promise<Intention> {
  await db.run(
    `INSERT INTO intentions (id, date, text, created_at) VALUES (?,?,?,?)
     ON CONFLICT(date) DO UPDATE SET text = excluded.text`,
    [newId('intent'), date, text.trim(), now],
  );
  const rows = await db.all('SELECT * FROM intentions WHERE date = ?', [date]);
  return toIntention(rows[0]!);
}

export async function getReflection(db: SqlDriver, weekStart: string): Promise<Reflection | null> {
  const rows = await db.all('SELECT * FROM reflections WHERE week_start = ?', [weekStart]);
  return rows[0] ? toReflection(rows[0]) : null;
}

export async function saveReflection(
  db: SqlDriver,
  weekStart: string,
  fields: {wins: string; blockers: string; nextSteps: string},
  now = Date.now(),
): Promise<Reflection> {
  await db.run(
    `INSERT INTO reflections (id, week_start, wins, blockers, next_steps, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(week_start) DO UPDATE SET wins = excluded.wins, blockers = excluded.blockers,
       next_steps = excluded.next_steps`,
    [newId('refl'), weekStart, fields.wins, fields.blockers, fields.nextSteps, now],
  );
  const rows = await db.all('SELECT * FROM reflections WHERE week_start = ?', [weekStart]);
  return toReflection(rows[0]!);
}

/* ------------------------------ favourite actions ---------------------------- */

export async function listFavorites(db: SqlDriver): Promise<FavoriteAction[]> {
  const rows = await db.all('SELECT * FROM favorite_actions ORDER BY position ASC');
  return rows.map(toFavorite);
}

export async function addFavorite(
  db: SqlDriver,
  action: string,
  label: string,
): Promise<FavoriteAction> {
  const id = newId('fav');
  const order = await db.all('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM favorite_actions');
  const position = Number(order[0]?.next ?? 0);
  await db.run('INSERT INTO favorite_actions (id, action, label, position) VALUES (?,?,?,?)', [
    id,
    action,
    label,
    position,
  ]);
  const rows = await db.all('SELECT * FROM favorite_actions WHERE id = ?', [id]);
  return toFavorite(rows[0]!);
}

export async function removeFavorite(db: SqlDriver, id: ID): Promise<void> {
  await db.run('DELETE FROM favorite_actions WHERE id = ?', [id]);
}

export async function seedFavorites(db: SqlDriver): Promise<void> {
  const existing = await db.all('SELECT COUNT(*) AS count FROM favorite_actions');
  if (Number(existing[0]?.count ?? 0) > 0) {
    return;
  }
  const seeds: [string, string][] = [
    ['create_task', 'New task'],
    ['create_note', 'New note'],
    ['start_pomodoro', 'Start focus'],
    ['query_schedule', 'What’s next'],
    ['find_free_time', 'Find free time'],
  ];
  await db.transaction(async tx => {
    let position = 0;
    for (const [action, label] of seeds) {
      await tx.run('INSERT INTO favorite_actions (id, action, label, position) VALUES (?,?,?,?)', [
        newId('fav'),
        action,
        label,
        position,
      ]);
      position += 1;
    }
  });
}
