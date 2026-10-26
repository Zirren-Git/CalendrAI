/**
 * Local backup: a single JSON document with every table.
 *
 * - export: reads the database, never the filesystem, so model weights are
 *   excluded by construction.
 * - import: validates structure, whitelists tables and columns (no SQL is ever
 *   built from untrusted identifiers) and runs in one transaction.
 */
import type {SqlDriver} from '../db/driver';

export const BACKUP_FORMAT = 'dayloom-backup';
export const BACKUP_VERSION = 1;

/** Child tables first so deletes and inserts satisfy foreign keys. */
export const BACKUP_TABLES = [
  'event_exceptions',
  'events',
  'tasks',
  'projects',
  'notes',
  'notebooks',
  'habit_logs',
  'habits',
  'routine_logs',
  'routines',
  'goals',
  'focus_sessions',
  'time_entries',
  'mood_checkins',
  'intentions',
  'reflections',
  'widget_layout',
  'favorite_actions',
  'reminders',
  'settings',
  'undo_log',
  'assistant_log',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export interface BackupDocument {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  app: string;
  tables: Partial<Record<BackupTable, Record<string, unknown>[]>>;
}

export interface BackupSummary {
  exportedAt: number;
  totalRows: number;
  perTable: Record<string, number>;
}

export async function exportBackup(db: SqlDriver, now = Date.now()): Promise<BackupDocument> {
  const tables: Partial<Record<BackupTable, Record<string, unknown>[]>> = {};
  for (const table of BACKUP_TABLES) {
    tables[table] = await db.all(`SELECT * FROM ${table}`);
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    app: 'Dayloom',
    tables,
  };
}

export function summariseBackup(doc: BackupDocument): BackupSummary {
  const perTable: Record<string, number> = {};
  let totalRows = 0;
  for (const [table, rows] of Object.entries(doc.tables)) {
    const count = rows?.length ?? 0;
    perTable[table] = count;
    totalRows += count;
  }
  return {exportedAt: doc.exportedAt, totalRows, perTable};
}

export class BackupValidationError extends Error {}

const MAX_ROWS_PER_TABLE = 200_000;

/** Validates an unknown JSON value as a backup document. */
export function validateBackup(input: unknown): BackupDocument {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BackupValidationError('Backup must be a JSON object');
  }
  const candidate = input as Record<string, unknown>;
  if (candidate.format !== BACKUP_FORMAT) {
    throw new BackupValidationError('Not a Dayloom backup file');
  }
  const version = Number(candidate.version);
  if (!Number.isInteger(version) || version < 1 || version > BACKUP_VERSION) {
    throw new BackupValidationError(`Unsupported backup version: ${String(candidate.version)}`);
  }
  const rawTables = candidate.tables;
  if (!rawTables || typeof rawTables !== 'object' || Array.isArray(rawTables)) {
    throw new BackupValidationError('Backup is missing its tables');
  }
  const tables: Partial<Record<BackupTable, Record<string, unknown>[]>> = {};
  for (const table of BACKUP_TABLES) {
    const rows = (rawTables as Record<string, unknown>)[table];
    if (rows === undefined) {
      continue;
    }
    if (!Array.isArray(rows)) {
      throw new BackupValidationError(`Table ${table} is not an array`);
    }
    if (rows.length > MAX_ROWS_PER_TABLE) {
      throw new BackupValidationError(`Table ${table} has too many rows`);
    }
    const sanitised: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new BackupValidationError(`Table ${table} contains a non-object row`);
      }
      const record = row as Record<string, unknown>;
      if (typeof record.id !== 'string' && table !== 'settings') {
        throw new BackupValidationError(`Table ${table} contains a row without a string id`);
      }
      for (const [key, value] of Object.entries(record)) {
        if (value !== null && value !== undefined && !isScalar(value) && typeof value !== 'boolean') {
          throw new BackupValidationError(
            `Table ${table} has a non-scalar value in column ${key}`,
          );
        }
      }
      sanitised.push(record);
    }
    tables[table] = sanitised;
  }
  const unknownTables = Object.keys(rawTables as Record<string, unknown>).filter(
    key => !(BACKUP_TABLES as readonly string[]).includes(key),
  );
  if (unknownTables.length > 0) {
    throw new BackupValidationError(`Backup contains unknown tables: ${unknownTables.join(', ')}`);
  }
  return {
    format: BACKUP_FORMAT,
    version,
    exportedAt: Number(candidate.exportedAt ?? Date.now()),
    app: typeof candidate.app === 'string' ? candidate.app : 'Dayloom',
    tables,
  };
}

async function tableColumns(db: SqlDriver, table: BackupTable): Promise<Set<string>> {
  const rows = await db.all(`PRAGMA table_info(${table})`);
  return new Set(rows.map(row => String(row.name)));
}

function isScalar(value: unknown): value is string | number | null {
  return value === null || typeof value === 'string' || typeof value === 'number';
}


export interface ImportOptions {
  /** `merge` skips rows whose primary key already exists; `replace` wipes first. */
  mode: 'merge' | 'replace';
}

export interface ImportResult {
  mode: ImportOptions['mode'];
  inserted: Record<string, number>;
  skipped: Record<string, number>;
  totalInserted: number;
}

/**
 * Imports a validated backup. `replace` is destructive and must only be called
 * after the UI has confirmed it with the user.
 */
export async function importBackup(
  db: SqlDriver,
  document: BackupDocument,
  options: ImportOptions,
): Promise<ImportResult> {
  const inserted: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  let totalInserted = 0;

  await db.exec('PRAGMA defer_foreign_keys = ON');
  await db.transaction(async tx => {
    if (options.mode === 'replace') {
      for (const table of BACKUP_TABLES) {
        await tx.run(`DELETE FROM ${table}`);
      }
    }
    for (const table of BACKUP_TABLES) {
      const rows = document.tables[table];
      if (!rows || rows.length === 0) {
        continue;
      }
      const allowed = await tableColumns(tx, table);
      for (const row of rows) {
        const keys = Object.keys(row).filter(key => allowed.has(key));
        if (keys.length === 0) {
          skipped[table] = (skipped[table] ?? 0) + 1;
          continue;
        }
        const values: (string | number | null)[] = [];
        let valid = true;
        for (const key of keys) {
          const value = row[key];
          if (value === undefined) {
            values.push(null);
          } else if (isScalar(value)) {
            values.push(value);
          } else if (typeof value === 'boolean') {
            values.push(value ? 1 : 0);
          } else {
            valid = false;
            break;
          }
        }
        if (!valid) {
          skipped[table] = (skipped[table] ?? 0) + 1;
          continue;
        }
        const placeholders = keys.map(() => '?').join(',');
        const verb = options.mode === 'merge' ? 'INSERT OR IGNORE' : 'INSERT';
        const result = await tx.run(
          `${verb} INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`,
          values,
        );
        if (result.rowsAffected > 0) {
          inserted[table] = (inserted[table] ?? 0) + 1;
          totalInserted += 1;
        } else {
          skipped[table] = (skipped[table] ?? 0) + 1;
        }
      }
    }
    const violations = await tx.all('PRAGMA foreign_key_check');
    if (violations.length > 0) {
      throw new BackupValidationError(
        `Import would break ${violations.length} foreign key reference(s); nothing was changed`,
      );
    }
  });
  return {mode: options.mode, inserted, skipped, totalInserted};
}
