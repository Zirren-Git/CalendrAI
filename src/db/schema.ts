import type {SqlDriver} from './driver';

/**
 * Schema and migrations.
 *
 * Every authoritative record lives here; nothing in the UI keeps durable state
 * in memory. Migrations are append-only and run inside a transaction: a failure
 * rolls back and leaves `PRAGMA user_version` untouched rather than wiping data.
 */

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

const V1: readonly string[] = [
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  `CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     color TEXT NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE events (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     location TEXT,
     notes TEXT,
     start_at INTEGER NOT NULL,
     end_at INTEGER NOT NULL,
     all_day INTEGER NOT NULL DEFAULT 0,
     timezone TEXT NOT NULL,
     color TEXT NOT NULL,
     attendees TEXT NOT NULL DEFAULT '[]',
     rrule TEXT,
     exception_parent_id TEXT REFERENCES events(id) ON DELETE CASCADE,
     occurrence_original_start INTEGER,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     deleted_at INTEGER
   )`,
  `CREATE INDEX idx_events_start ON events(start_at)`,
  `CREATE INDEX idx_events_deleted ON events(deleted_at)`,
  `CREATE INDEX idx_events_parent ON events(exception_parent_id)`,

  `CREATE TABLE event_exceptions (
     id TEXT PRIMARY KEY,
     event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
     occurrence_start INTEGER NOT NULL,
     cancelled INTEGER NOT NULL DEFAULT 1,
     override_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL,
     UNIQUE(event_id, occurrence_start)
   )`,

  `CREATE TABLE reminders (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     source_id TEXT,
     title TEXT NOT NULL,
     body TEXT,
     trigger_at INTEGER NOT NULL,
     fired_at INTEGER,
     dismissed_at INTEGER,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX idx_reminders_trigger ON reminders(trigger_at)`,

  `CREATE TABLE tasks (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     notes TEXT,
     project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
     parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
     priority INTEGER NOT NULL DEFAULT 1,
     due_at INTEGER,
     due_has_time INTEGER NOT NULL DEFAULT 0,
     recurrence TEXT,
     completed_at INTEGER,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     deleted_at INTEGER
   )`,
  `CREATE INDEX idx_tasks_due ON tasks(due_at)`,
  `CREATE INDEX idx_tasks_project ON tasks(project_id)`,
  `CREATE INDEX idx_tasks_deleted ON tasks(deleted_at)`,

  `CREATE TABLE notebooks (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     color TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE notes (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     body TEXT NOT NULL DEFAULT '',
     notebook_id TEXT REFERENCES notebooks(id) ON DELETE SET NULL,
     tags TEXT NOT NULL DEFAULT '[]',
     pinned INTEGER NOT NULL DEFAULT 0,
     journal_date TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     deleted_at INTEGER
   )`,
  `CREATE INDEX idx_notes_updated ON notes(updated_at)`,
  `CREATE INDEX idx_notes_journal ON notes(journal_date)`,

  `CREATE TABLE habits (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     emoji TEXT NOT NULL DEFAULT '•',
     color TEXT NOT NULL,
     schedule TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
     target_per_week INTEGER NOT NULL DEFAULT 7,
     archived INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE habit_logs (
     id TEXT PRIMARY KEY,
     habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
     date TEXT NOT NULL,
     value INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL,
     UNIQUE(habit_id, date)
   )`,

  `CREATE TABLE routines (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     name TEXT NOT NULL,
     items TEXT NOT NULL DEFAULT '[]',
     enabled INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE routine_logs (
     id TEXT PRIMARY KEY,
     routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
     date TEXT NOT NULL,
     completed_items TEXT NOT NULL DEFAULT '[]',
     created_at INTEGER NOT NULL,
     UNIQUE(routine_id, date)
   )`,

  `CREATE TABLE goals (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     description TEXT,
     metric_unit TEXT NOT NULL DEFAULT '',
     target INTEGER NOT NULL DEFAULT 1,
     current INTEGER NOT NULL DEFAULT 0,
     due_date TEXT,
     status TEXT NOT NULL DEFAULT 'active',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,

  `CREATE TABLE focus_sessions (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL DEFAULT 'focus',
     label TEXT NOT NULL DEFAULT 'Focus',
     task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
     started_at INTEGER NOT NULL,
     ended_at INTEGER,
     planned_minutes INTEGER NOT NULL DEFAULT 25,
     completed INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX idx_focus_started ON focus_sessions(started_at)`,

  `CREATE TABLE time_entries (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     category TEXT NOT NULL DEFAULT 'general',
     started_at INTEGER NOT NULL,
     ended_at INTEGER,
     source TEXT NOT NULL DEFAULT 'manual',
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE mood_checkins (
     id TEXT PRIMARY KEY,
     date TEXT NOT NULL UNIQUE,
     mood INTEGER NOT NULL,
     energy INTEGER NOT NULL,
     note TEXT,
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE intentions (
     id TEXT PRIMARY KEY,
     date TEXT NOT NULL UNIQUE,
     text TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE reflections (
     id TEXT PRIMARY KEY,
     week_start TEXT NOT NULL UNIQUE,
     wins TEXT NOT NULL DEFAULT '',
     blockers TEXT NOT NULL DEFAULT '',
     next_steps TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE widget_layout (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     position INTEGER NOT NULL,
     span INTEGER NOT NULL DEFAULT 2,
     config TEXT NOT NULL DEFAULT '{}',
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE favorite_actions (
     id TEXT PRIMARY KEY,
     action TEXT NOT NULL,
     label TEXT NOT NULL,
     position INTEGER NOT NULL
   )`,

  `CREATE TABLE undo_log (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     payload TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE assistant_log (
     id TEXT PRIMARY KEY,
     transcript TEXT,
     input TEXT NOT NULL,
     plan TEXT,
     status TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
];

const V2: readonly string[] = [
  // Launcher widgets cannot run the recurrence engine, so JS materialises the
  // next few weeks of occurrences here. It is a cache: the events table stays
  // authoritative and this table is rebuilt on every change.
  `CREATE TABLE occurrence_cache (
     id TEXT PRIMARY KEY,
     event_id TEXT NOT NULL,
     occurrence_start INTEGER NOT NULL,
     title TEXT NOT NULL,
     start_at INTEGER NOT NULL,
     end_at INTEGER NOT NULL,
     all_day INTEGER NOT NULL DEFAULT 0,
     color TEXT NOT NULL,
     refreshed_at INTEGER NOT NULL
   )`,
  `CREATE INDEX idx_occ_cache_start ON occurrence_cache(start_at)`,
];

export const MIGRATIONS: readonly Migration[] = [
  {version: 1, name: 'initial', statements: V1},
  {version: 2, name: 'occurrence_cache', statements: V2},
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

function userVersion(db: SqlDriver): Promise<number> {
  return db.all('PRAGMA user_version').then(rows => {
    const row = rows[0];
    const value = row ? Object.values(row)[0] : 0;
    return typeof value === 'number' ? value : Number(value ?? 0);
  });
}

export interface MigrationResult {
  from: number;
  to: number;
  applied: readonly string[];
}

/**
 * Applies pending migrations. Throws (leaving the database untouched) if a
 * migration fails, so a broken upgrade never silently erases user data.
 */
export async function migrate(
  db: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationResult> {
  const from = await userVersion(db);
  const target = migrations[migrations.length - 1]?.version ?? 0;
  if (from > target) {
    throw new Error(
      `Database schema (v${from}) is newer than this build supports (v${target}). Refusing to touch it.`,
    );
  }
  const applied: string[] = [];
  for (const migration of migrations) {
    if (migration.version <= from) {
      continue;
    }
    await db.transaction(async tx => {
      for (const statement of migration.statements) {
        await tx.exec(statement);
      }
      // user_version must be set inside the same transaction so a crash can
      // never leave a half-migrated database that claims to be upgraded.
      await tx.exec(`PRAGMA user_version = ${migration.version}`);
    });
    applied.push(migration.name);
  }
  return {from, to: await userVersion(db), applied};
}

export async function configureConnection(db: SqlDriver): Promise<void> {
  await db.exec('PRAGMA foreign_keys = ON');
  try {
    await db.exec('PRAGMA journal_mode = WAL');
  } catch {
    // In-memory databases (tests) cannot use WAL.
  }
  await db.exec('PRAGMA busy_timeout = 4000');
}
