/**
 * Storage abstraction.
 *
 * The app's repositories are written against this interface only. Production
 * uses op-sqlite (src/db/opSqliteDriver.ts); tests use Node's built-in SQLite
 * (src/db/nodeDriver.ts) so schema, migrations and every SQL statement are
 * exercised against a real SQLite engine rather than a mock.
 */
export type SqlValue = string | number | boolean | null | Uint8Array;

export interface SqlRunResult {
  rowsAffected: number;
  insertId?: number;
}

export interface SqlDriver {
  /** Runs a statement returning all rows. */
  all(sql: string, params?: SqlValue[]): Promise<Record<string, unknown>[]>;
  /** Runs a statement returning only affected-row information. */
  run(sql: string, params?: SqlValue[]): Promise<SqlRunResult>;
  /** Runs a multi-statement script (DDL). */
  exec(sql: string): Promise<void>;
  /** Runs `fn` inside one transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
  close(): void;
}

/** SQLite has no boolean type; normalise before binding. */
export function normaliseParams(params: SqlValue[] | undefined): SqlValue[] {
  if (!params) {
    return [];
  }
  return params.map(value => {
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    return value;
  });
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

export function asNullableString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return typeof value === 'string' ? value : String(value);
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function asBool(value: unknown): boolean {
  return asNumber(value, 0) !== 0;
}

export function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export function parseJsonObject<T>(value: unknown, validate: (input: unknown) => T, fallback: T): T {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }
  try {
    return validate(JSON.parse(value));
  } catch {
    return fallback;
  }
}
