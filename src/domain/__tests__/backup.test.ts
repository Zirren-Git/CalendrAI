import {NodeSqliteDriver} from '../../db/nodeDriver';
import {initializeDatabase} from '../../db';
import {createEvent} from '../../repos/events';
import {createTask, listTasks} from '../../repos/tasks';
import {createNote, listNotes} from '../../repos/notes';
import {
  BackupValidationError,
  exportBackup,
  importBackup,
  summariseBackup,
  validateBackup,
} from '../backup';

const TZ = 'UTC';

async function seededDb() {
  const db = new NodeSqliteDriver();
  await initializeDatabase(db);
  await createEvent(db, {title: 'Review', start: 1000, end: 2000, timezone: TZ});
  await createTask(db, {title: 'Ship it'});
  await createNote(db, {title: 'Plan', body: 'notes'});
  return db;
}

describe('backup export', () => {
  it('includes every table and excludes no user data', async () => {
    const db = await seededDb();
    const doc = await exportBackup(db);
    expect(doc.format).toBe('dayloom-backup');
    expect(doc.tables.events).toHaveLength(1);
    expect(doc.tables.tasks).toHaveLength(1);
    expect(doc.tables.notes).toHaveLength(1);
    const summary = summariseBackup(doc);
    expect(summary.totalRows).toBeGreaterThan(3);
    db.close();
  });
});

describe('backup validation', () => {
  it('rejects a non-backup document', () => {
    expect(() => validateBackup({hello: 'world'})).toThrow(BackupValidationError);
  });

  it('rejects unknown tables and future versions', async () => {
    const db = await seededDb();
    const doc = await exportBackup(db);
    expect(() => validateBackup({...doc, version: 99})).toThrow(/Unsupported backup version/);
    expect(() =>
      validateBackup({...doc, tables: {...doc.tables, sqlite_master: []}}),
    ).toThrow(/unknown tables/);
    db.close();
  });

  it('rejects rows with non-scalar values', () => {
    const doc = {
      format: 'dayloom-backup',
      version: 1,
      exportedAt: 1,
      app: 'Dayloom',
      tables: {tasks: [{id: 'a', title: 'x', notes: {nested: true}}]},
    };
    expect(() => validateBackup(doc)).toThrow(/non-scalar value/);
  });
});

describe('backup import', () => {
  it('merges into an existing database and skips duplicates', async () => {
    const source = await seededDb();
    const doc = await exportBackup(source);
    const target = new NodeSqliteDriver();
    await initializeDatabase(target);

    const first = await importBackup(target, validateBackup(doc), {mode: 'merge'});
    expect(first.totalInserted).toBeGreaterThanOrEqual(3);
    expect((await listTasks(target)).length).toBeGreaterThanOrEqual(1);

    const second = await importBackup(target, validateBackup(doc), {mode: 'merge'});
    expect(second.totalInserted).toBe(0);
    expect(Object.values(second.skipped).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

    source.close();
    target.close();
  });

  it('replaces existing data only when asked', async () => {
    const source = await seededDb();
    const doc = await exportBackup(source);
    const target = new NodeSqliteDriver();
    await initializeDatabase(target);
    await createTask(target, {title: 'Will be replaced'});

    await importBackup(target, validateBackup(doc), {mode: 'replace'});
    const titles = (await listTasks(target, {includeCompleted: true})).map(t => t.title);
    expect(titles).toContain('Ship it');
    expect(titles).not.toContain('Will be replaced');
    expect((await listNotes(target)).map(n => n.title)).toContain('Plan');

    source.close();
    target.close();
  });

  it('rolls back everything when foreign keys would break', async () => {
    const db = new NodeSqliteDriver();
    await initializeDatabase(db);
    const bad = {
      format: 'dayloom-backup' as const,
      version: 1,
      exportedAt: Date.now(),
      app: 'Dayloom',
      tables: {
        event_exceptions: [
          {id: 'exc-1', event_id: 'missing-event', occurrence_start: 0, cancelled: 1, created_at: 1},
        ],
      },
    };
    await expect(importBackup(db, validateBackup(bad), {mode: 'merge'})).rejects.toThrow(
      /foreign key/,
    );
    const rows = await db.all('SELECT * FROM event_exceptions');
    expect(rows).toHaveLength(0);
    db.close();
  });
});
