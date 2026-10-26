import {open} from '@op-engineering/op-sqlite';
import type {DB} from '@op-engineering/op-sqlite';

import {
  normaliseParams,
  type SqlDriver,
  type SqlRunResult,
  type SqlValue,
} from './driver';

/**
 * Production driver. The database lives in app-private storage
 * (/data/data/<pkg>/databases/dayloom.db) so Android auto-backup rules and the
 * app's own file scoping both apply.
 */
export class OpSqliteDriver implements SqlDriver {
  private readonly db: DB;
  private txDepth = 0;

  constructor(db: DB) {
    this.db = db;
  }

  static openDatabase(name = 'dayloom.db'): OpSqliteDriver {
    return new OpSqliteDriver(open({name}));
  }

  async all(sql: string, params?: SqlValue[]): Promise<Record<string, unknown>[]> {
    const result = await this.db.execute(sql, normaliseParams(params));
    return (result.rows ?? []) as Record<string, unknown>[];
  }

  async run(sql: string, params?: SqlValue[]): Promise<SqlRunResult> {
    const result = await this.db.execute(sql, normaliseParams(params));
    return {
      rowsAffected: result.rowsAffected ?? 0,
      insertId: result.insertId,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.db.execute(sql);
  }

  async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
    // op-sqlite nests transactions with savepoints internally when a
    // transaction is started from inside another one.
    if (this.txDepth > 0) {
      this.txDepth += 1;
      try {
        return await fn(this);
      } finally {
        this.txDepth -= 1;
      }
    }
    let result!: T;
    await this.db.transaction(async tx => {
      const scoped: SqlDriver = {
        all: async (sql, params) => {
          const r = await tx.execute(sql, normaliseParams(params));
          return (r.rows ?? []) as Record<string, unknown>[];
        },
        run: async (sql, params) => {
          const r = await tx.execute(sql, normaliseParams(params));
          return {rowsAffected: r.rowsAffected ?? 0, insertId: r.insertId};
        },
        exec: async sql => {
          await tx.execute(sql);
        },
        transaction: async inner => inner(scoped),
        close: () => undefined,
      };
      this.txDepth += 1;
      try {
        result = await fn(scoped);
      } finally {
        this.txDepth -= 1;
      }
    });
    return result;
  }

  close(): void {
    this.db.close();
  }
}
