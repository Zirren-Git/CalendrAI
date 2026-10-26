import type {SqlDriver} from '../db/driver';
import type {ID, Reminder, ReminderKind} from '../domain/types';
import {newId, toReminder} from './mappers';

export async function createReminder(
  db: SqlDriver,
  input: {kind: ReminderKind; sourceId?: ID | null; title: string; body?: string | null; triggerAt: number},
  now = Date.now(),
): Promise<Reminder> {
  if (!Number.isFinite(input.triggerAt)) {
    throw new Error('Reminder needs a valid trigger time');
  }
  if (!input.title.trim()) {
    throw new Error('Reminder needs a title');
  }
  const id = newId('rem');
  await db.run(
    `INSERT INTO reminders (id, kind, source_id, title, body, trigger_at, fired_at, dismissed_at, created_at)
     VALUES (?,?,?,?,?,?,NULL,NULL,?)`,
    [id, input.kind, input.sourceId ?? null, input.title.trim(), input.body ?? null, input.triggerAt, now],
  );
  const rows = await db.all('SELECT * FROM reminders WHERE id = ?', [id]);
  return toReminder(rows[0]!);
}

export async function listReminders(db: SqlDriver, includeDismissed = false): Promise<Reminder[]> {
  const rows = await db.all(
    `SELECT * FROM reminders ${includeDismissed ? '' : 'WHERE dismissed_at IS NULL'} ORDER BY trigger_at ASC`,
  );
  return rows.map(toReminder);
}

export async function upcomingReminders(
  db: SqlDriver,
  from: number,
  to: number,
): Promise<Reminder[]> {
  const rows = await db.all(
    `SELECT * FROM reminders
     WHERE dismissed_at IS NULL AND trigger_at >= ? AND trigger_at <= ?
     ORDER BY trigger_at ASC`,
    [from, to],
  );
  return rows.map(toReminder);
}

export async function dismissReminder(db: SqlDriver, id: ID, now = Date.now()): Promise<void> {
  await db.run('UPDATE reminders SET dismissed_at = ? WHERE id = ?', [now, id]);
}

export async function markReminderFired(db: SqlDriver, id: ID, now = Date.now()): Promise<void> {
  await db.run('UPDATE reminders SET fired_at = ? WHERE id = ?', [now, id]);
}

export async function deleteReminder(db: SqlDriver, id: ID): Promise<void> {
  await db.run('DELETE FROM reminders WHERE id = ?', [id]);
}

/**
 * Rebuilds the pending reminder rows for a task. Called after any task edit so
 * the launcher widget and the native scheduler see one consistent source.
 */
export async function syncTaskReminder(
  db: SqlDriver,
  task: {id: ID; title: string; dueAt: number | null},
  minutesBefore = 10,
  now = Date.now(),
): Promise<Reminder | null> {
  await db.run(
    `DELETE FROM reminders WHERE kind = 'task' AND source_id = ? AND dismissed_at IS NULL`,
    [task.id],
  );
  if (task.dueAt === null) {
    return null;
  }
  const triggerAt = task.dueAt - minutesBefore * 60_000;
  if (triggerAt <= now) {
    return null;
  }
  return createReminder(
    db,
    {
      kind: 'task',
      sourceId: task.id,
      title: task.title,
      body: `Due in ${minutesBefore} minutes`,
      triggerAt,
    },
    now,
  );
}
