import type {SqlDriver} from '../db/driver';
import {asNumber, asString} from '../db/driver';
import type {ID, Settings, WidgetPlacement} from '../domain/types';
import {detectTimeZone} from '../domain/time';
import {newId, toPlacement} from './mappers';

/* --------------------------------- settings ---------------------------------- */

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  weekStartsOn: 1,
  clock24h: false,
  workdayStart: 9 * 60,
  workdayEnd: 18 * 60,
  defaultEventMinutes: 60,
  retainTranscripts: false,
  autoExecuteSafeCommands: false,
  onboarded: false,
  wifiOnlyDownloads: true,
  modelDir: '',
  pomodoroMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  notificationsEnabled: true,
  hapticsEnabled: true,
  calendarTimeZone: detectTimeZone(),
};

type SettingsKey = keyof Settings;

export async function getSettings(db: SqlDriver): Promise<Settings> {
  const rows = await db.all('SELECT key, value FROM settings');
  const stored = new Map<string, string>();
  for (const row of rows) {
    stored.set(asString(row.key), asString(row.value));
  }
  const merged: Settings = {...DEFAULT_SETTINGS};
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingsKey[]) {
    const raw = stored.get(key);
    if (raw === undefined) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      // Values are written through setSetting(), which is typed by key; the
      // stored JSON is still validated by the consumers (theme union, etc.).
      (merged as unknown as Record<string, unknown>)[key] = parsed;
    } catch {
      // A corrupt value falls back to the default instead of failing boot.
    }
  }
  if (!merged.calendarTimeZone) {
    merged.calendarTimeZone = detectTimeZone();
  }
  return merged;
}

export async function setSetting<K extends SettingsKey>(
  db: SqlDriver,
  key: K,
  value: Settings[K],
): Promise<void> {
  await db.run(
    `INSERT INTO settings (key, value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}

/* ------------------------------ widget layout -------------------------------- */

export const DEFAULT_WIDGET_KINDS: {kind: string; span: number}[] = [
  {kind: 'today_agenda', span: 2},
  {kind: 'next_event', span: 1},
  {kind: 'tasks_today', span: 2},
  {kind: 'completion_ring', span: 1},
  {kind: 'daily_habit_checklist', span: 2},
  {kind: 'pomodoro_timer', span: 1},
  {kind: 'quick_note', span: 1},
  {kind: 'favorite_actions', span: 2},
];

export async function listWidgetLayout(db: SqlDriver): Promise<WidgetPlacement[]> {
  const rows = await db.all('SELECT * FROM widget_layout ORDER BY position ASC');
  return rows.map(toPlacement);
}

export async function seedWidgetLayout(db: SqlDriver, now = Date.now()): Promise<void> {
  const existing = await db.all('SELECT COUNT(*) AS count FROM widget_layout');
  if (asNumber(existing[0]?.count) > 0) {
    return;
  }
  await db.transaction(async tx => {
    let position = 0;
    for (const entry of DEFAULT_WIDGET_KINDS) {
      await tx.run(
        'INSERT INTO widget_layout (id, kind, position, span, config, created_at) VALUES (?,?,?,?,?,?)',
        [newId('w'), entry.kind, position, entry.span, '{}', now],
      );
      position += 1;
    }
  });
}

export async function saveWidgetLayout(
  db: SqlDriver,
  placements: readonly {kind: string; span: number; config: Record<string, unknown>}[],
  now = Date.now(),
): Promise<WidgetPlacement[]> {
  await db.transaction(async tx => {
    await tx.run('DELETE FROM widget_layout');
    let position = 0;
    for (const placement of placements) {
      await tx.run(
        'INSERT INTO widget_layout (id, kind, position, span, config, created_at) VALUES (?,?,?,?,?,?)',
        [newId('w'), placement.kind, position, placement.span, JSON.stringify(placement.config), now],
      );
      position += 1;
    }
  });
  return listWidgetLayout(db);
}

export async function resetWidgetLayout(db: SqlDriver, now = Date.now()): Promise<WidgetPlacement[]> {
  await db.run('DELETE FROM widget_layout');
  await seedWidgetLayout(db, now);
  return listWidgetLayout(db);
}

export async function updateWidgetConfig(
  db: SqlDriver,
  id: ID,
  config: Record<string, unknown>,
): Promise<void> {
  await db.run('UPDATE widget_layout SET config = ? WHERE id = ?', [JSON.stringify(config), id]);
}

/* ----------------------------------- undo ------------------------------------ */

const UNDOABLE_TABLES = new Set([
  'events',
  'tasks',
  'notes',
  'goals',
  'projects',
  'habits',
  'notebooks',
]);

export interface UndoPayload {
  restore: {table: string; ids: ID[]}[];
}

export interface UndoEntry {
  token: string;
  label: string;
  createdAt: number;
}

export async function recordUndo(
  db: SqlDriver,
  label: string,
  payload: UndoPayload,
  now = Date.now(),
): Promise<UndoEntry> {
  for (const item of payload.restore) {
    if (!UNDOABLE_TABLES.has(item.table)) {
      throw new Error(`Table ${item.table} is not undoable`);
    }
  }
  const token = newId('undo');
  await db.run('INSERT INTO undo_log (id, label, payload, created_at) VALUES (?,?,?,?)', [
    token,
    label,
    JSON.stringify(payload),
    now,
  ]);
  // Keep the log bounded; undo is a short-lived affordance.
  await db.run(
    'DELETE FROM undo_log WHERE id NOT IN (SELECT id FROM undo_log ORDER BY created_at DESC LIMIT 25)',
  );
  return {token, label, createdAt: now};
}

/** Restores soft-deleted rows referenced by an undo token. */
export async function applyUndo(db: SqlDriver, token: string): Promise<boolean> {
  const rows = await db.all('SELECT payload FROM undo_log WHERE id = ?', [token]);
  const payloadRaw = rows[0]?.payload;
  if (!payloadRaw) {
    return false;
  }
  let payload: UndoPayload;
  try {
    const parsed: unknown = JSON.parse(String(payloadRaw));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as UndoPayload).restore)) {
      return false;
    }
    payload = parsed as UndoPayload;
  } catch {
    return false;
  }
  await db.transaction(async tx => {
    for (const item of payload.restore) {
      if (!UNDOABLE_TABLES.has(item.table) || item.ids.length === 0) {
        continue;
      }
      const placeholders = item.ids.map(() => '?').join(',');
      await tx.run(`UPDATE ${item.table} SET deleted_at = NULL WHERE id IN (${placeholders})`, [
        ...item.ids,
      ]);
    }
    await tx.run('DELETE FROM undo_log WHERE id = ?', [token]);
  });
  return true;
}

export async function latestUndo(db: SqlDriver): Promise<UndoEntry | null> {
  const rows = await db.all('SELECT * FROM undo_log ORDER BY created_at DESC LIMIT 1');
  if (!rows[0]) {
    return null;
  }
  return {
    token: asString(rows[0].id),
    label: asString(rows[0].label),
    createdAt: asNumber(rows[0].created_at),
  };
}

/* -------------------------------- assistant log ------------------------------- */

export async function logAssistantTurn(
  db: SqlDriver,
  turn: {input: string; transcript: string | null; plan: string | null; status: string},
  now = Date.now(),
): Promise<void> {
  // Deliberately stores only the command text and the plan summary — never
  // calendar contents or model prompts (see docs/privacy.md).
  await db.run(
    'INSERT INTO assistant_log (id, transcript, input, plan, status, created_at) VALUES (?,?,?,?,?,?)',
    [newId('turn'), turn.transcript, turn.input, turn.plan, turn.status, now],
  );
  await db.run(
    'DELETE FROM assistant_log WHERE id NOT IN (SELECT id FROM assistant_log ORDER BY created_at DESC LIMIT 100)',
  );
}
