import type {SqlDriver} from '../db/driver';
import type {FocusSession, ID, TimeEntry} from '../domain/types';
import {newId, toFocusSession, toTimeEntry} from './mappers';

export async function startSession(
  db: SqlDriver,
  options: {label: string; plannedMinutes: number; kind?: 'focus' | 'break'; taskId?: ID | null},
  now = Date.now(),
): Promise<FocusSession> {
  const id = newId('focus');
  await db.run(
    `INSERT INTO focus_sessions (id, kind, label, task_id, started_at, ended_at, planned_minutes, completed, created_at)
     VALUES (?,?,?,?,?,NULL,?,0,?)`,
    [
      id,
      options.kind ?? 'focus',
      options.label.trim() || 'Focus',
      options.taskId ?? null,
      now,
      options.plannedMinutes,
      now,
    ],
  );
  const rows = await db.all('SELECT * FROM focus_sessions WHERE id = ?', [id]);
  return toFocusSession(rows[0]!);
}

export async function endSession(
  db: SqlDriver,
  id: ID,
  completed: boolean,
  now = Date.now(),
): Promise<FocusSession> {
  await db.run('UPDATE focus_sessions SET ended_at = ?, completed = ? WHERE id = ?', [now, completed, id]);
  const rows = await db.all('SELECT * FROM focus_sessions WHERE id = ?', [id]);
  if (!rows[0]) {
    throw new Error('Focus session not found');
  }
  return toFocusSession(rows[0]);
}

export async function activeSession(db: SqlDriver): Promise<FocusSession | null> {
  const rows = await db.all(
    'SELECT * FROM focus_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
  );
  return rows[0] ? toFocusSession(rows[0]) : null;
}

export async function sessionsBetween(
  db: SqlDriver,
  start: number,
  end: number,
): Promise<FocusSession[]> {
  const rows = await db.all(
    'SELECT * FROM focus_sessions WHERE started_at >= ? AND started_at <= ? ORDER BY started_at ASC',
    [start, end],
  );
  return rows.map(toFocusSession);
}

export async function recentSessions(db: SqlDriver, limit = 20): Promise<FocusSession[]> {
  const rows = await db.all('SELECT * FROM focus_sessions ORDER BY started_at DESC LIMIT ?', [limit]);
  return rows.map(toFocusSession);
}

export function totalFocusMinutes(sessions: readonly FocusSession[]): number {
  return sessions
    .filter(session => session.kind === 'focus' && session.endedAt !== null)
    .reduce((sum, session) => sum + (session.endedAt! - session.startedAt) / 60_000, 0);
}

export async function addTimeEntry(
  db: SqlDriver,
  entry: {label: string; category?: string; startedAt: number; endedAt: number | null; source?: 'manual' | 'focus'},
  now = Date.now(),
): Promise<TimeEntry> {
  if (entry.endedAt !== null && entry.endedAt < entry.startedAt) {
    throw new Error('Time entry cannot end before it starts');
  }
  const id = newId('time');
  await db.run(
    `INSERT INTO time_entries (id, label, category, started_at, ended_at, source, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      id,
      entry.label.trim() || 'Untitled',
      entry.category ?? 'general',
      entry.startedAt,
      entry.endedAt,
      entry.source ?? 'manual',
      now,
    ],
  );
  const rows = await db.all('SELECT * FROM time_entries WHERE id = ?', [id]);
  return toTimeEntry(rows[0]!);
}

export async function timeEntriesBetween(
  db: SqlDriver,
  start: number,
  end: number,
): Promise<TimeEntry[]> {
  const rows = await db.all(
    'SELECT * FROM time_entries WHERE started_at >= ? AND started_at <= ? ORDER BY started_at ASC',
    [start, end],
  );
  return rows.map(toTimeEntry);
}
