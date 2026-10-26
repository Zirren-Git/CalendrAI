import type {SqlDriver} from '../db/driver';
import type {Habit, HabitLog, ID} from '../domain/types';
import {newId, toHabit, toHabitLog} from './mappers';

export interface HabitInput {
  name: string;
  emoji?: string;
  color?: string;
  schedule?: number[];
  targetPerWeek?: number;
}

export async function listHabits(db: SqlDriver, includeArchived = false): Promise<Habit[]> {
  const rows = await db.all(
    `SELECT * FROM habits ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY created_at ASC, name ASC`,
  );
  return rows.map(toHabit);
}

export async function getHabit(db: SqlDriver, id: ID): Promise<Habit | null> {
  const rows = await db.all('SELECT * FROM habits WHERE id = ?', [id]);
  return rows[0] ? toHabit(rows[0]) : null;
}

export async function createHabit(
  db: SqlDriver,
  input: HabitInput,
  now = Date.now(),
): Promise<Habit> {
  if (!input.name.trim()) {
    throw new Error('Habit name is required');
  }
  const id = newId('habit');
  const schedule = input.schedule ?? [0, 1, 2, 3, 4, 5, 6];
  await db.run(
    `INSERT INTO habits (id, name, emoji, color, schedule, target_per_week, archived, created_at)
     VALUES (?,?,?,?,?,?,0,?)`,
    [
      id,
      input.name.trim(),
      input.emoji ?? '•',
      input.color ?? '#6F7F63',
      JSON.stringify(schedule),
      input.targetPerWeek ?? schedule.length,
      now,
    ],
  );
  const created = await getHabit(db, id);
  if (!created) {
    throw new Error('Habit insert failed');
  }
  return created;
}

export interface HabitPatch {
  name?: string;
  emoji?: string;
  color?: string;
  schedule?: number[];
  targetPerWeek?: number;
  archived?: boolean;
}

export async function updateHabit(
  db: SqlDriver,
  id: ID,
  patch: HabitPatch,
): Promise<Habit> {
  const existing = await getHabit(db, id);
  if (!existing) {
    throw new Error('Habit not found');
  }
  const next = {...existing, ...patch};
  await db.run(
    `UPDATE habits SET name=?, emoji=?, color=?, schedule=?, target_per_week=?, archived=? WHERE id=?`,
    [
      next.name.trim(),
      next.emoji,
      next.color,
      JSON.stringify(next.schedule),
      next.targetPerWeek,
      next.archived,
      id,
    ],
  );
  const updated = await getHabit(db, id);
  if (!updated) {
    throw new Error('Habit update failed');
  }
  return updated;
}

export async function deleteHabit(db: SqlDriver, id: ID): Promise<void> {
  // Habits have no soft-delete column; archiving keeps history intact.
  await updateHabit(db, id, {archived: true});
}

/** Checks a habit off (or un-checks it) for a local date. Idempotent. */
export async function setHabitLog(
  db: SqlDriver,
  habitId: ID,
  date: string,
  done: boolean,
  now = Date.now(),
): Promise<void> {
  if (done) {
    await db.run(
      `INSERT INTO habit_logs (id, habit_id, date, value, created_at) VALUES (?,?,?,1,?)
       ON CONFLICT(habit_id, date) DO UPDATE SET value = 1`,
      [newId('hl'), habitId, date, now],
    );
    return;
  }
  await db.run('DELETE FROM habit_logs WHERE habit_id = ? AND date = ?', [habitId, date]);
}

export async function listHabitLogs(
  db: SqlDriver,
  startDate: string,
  endDate: string,
): Promise<HabitLog[]> {
  const rows = await db.all(
    'SELECT * FROM habit_logs WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [startDate, endDate],
  );
  return rows.map(toHabitLog);
}

export async function logsForHabit(db: SqlDriver, habitId: ID): Promise<HabitLog[]> {
  const rows = await db.all('SELECT * FROM habit_logs WHERE habit_id = ? ORDER BY date ASC', [habitId]);
  return rows.map(toHabitLog);
}
