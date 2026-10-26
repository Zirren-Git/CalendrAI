import {DatabaseSync} from 'node:sqlite';

import {
  normaliseParams,
  type SqlDriver,
  type SqlRunResult,
  type SqlValue,
} from './driver';

/**
 * Test/dev driver backed by Node's built-in SQLite (node:sqlite). Used by the
 * Jest suite so migrations, constraints and query behaviour are verified on a
 * real engine. Never imported by the app bundle.
 */
export class NodeSqliteDriver implements SqlDriver {
  private readonly db: DatabaseSync;
  private savepointDepth = 0;

  constructor(location = ':memory:') {
    this.db = new DatabaseSync(location);
  }

  async all(sql: string, params?: SqlValue[]): Promise<Record<string, unknown>[]> {
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...(normaliseParams(params) as never[]));
    return rows as Record<string, unknown>[];
  }

  async run(sql: string, params?: SqlValue[]): Promise<SqlRunResult> {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...(normaliseParams(params) as never[]));
    return {
      rowsAffected: Number(result.changes ?? 0),
      insertId: Number(result.lastInsertRowid ?? 0),
    };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
    const depth = this.savepointDepth;
    const name = `sp_${depth}`;
    this.savepointDepth += 1;
    try {
      await this.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
      const result = await fn(this);
      await this.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
      return result;
    } catch (error) {
      try {
        await this.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
        if (depth > 0) {
          await this.exec(`RELEASE ${name}`);
        }
      } catch {
        // The transaction was already rolled back by SQLite.
      }
      throw error;
    } finally {
      this.savepointDepth = depth;
    }
  }

  close(): void {
    this.db.close();
  }
}
