import {initializeDatabase, SCHEMA_VERSION} from '../index';
import {NodeSqliteDriver} from '../nodeDriver';
import {migrate} from '../schema';
import {createEvent, deleteEvent, listOccurrences, overrideOccurrence} from '../../repos/events';
import {
  bucketTasks,
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  restoreTasks,
} from '../../repos/tasks';
import {createHabit, listHabits, setHabitLog, listHabitLogs} from '../../repos/habits';
import {applyUndo, getSettings, listWidgetLayout, recordUndo, setSetting} from '../../repos/system';
import {createNote, listNotes, upsertJournal} from '../../repos/notes';
import {search} from '../../repos/search';
import {createReminder, upcomingReminders} from '../../repos/reminders';
import {computeHabitProgress} from '../../domain/habits';
import {findConflicts, findFreeSlots} from '../../domain/events';
import {localDateKey, wallClockToUtc} from '../../domain/time';

const TZ = 'America/New_York';

async function freshDb() {
  const db = new NodeSqliteDriver();
  const boot = await initializeDatabase(db);
  return {db, boot};
}

describe('schema and migration', () => {
  it('boots an empty database to the current version', async () => {
    const {db, boot} = await freshDb();
    expect(boot.migration.from).toBe(0);
    expect(boot.migration.to).toBe(SCHEMA_VERSION);
    const version = await db.all('PRAGMA user_version');
    expect(Object.values(version[0]!)[0]).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('is idempotent across repeated boots', async () => {
    const db = new NodeSqliteDriver();
    await initializeDatabase(db);
    const second = await initializeDatabase(db);
    expect(second.migration.applied).toEqual([]);
    const layout = await listWidgetLayout(db);
    expect(layout.length).toBe(8);
    db.close();
  });

  it('refuses to open a database written by a newer build', async () => {
    const db = new NodeSqliteDriver();
    await initializeDatabase(db);
    await db.exec('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toThrow(/newer than this build/);
    db.close();
  });

  it('rolls back a failed migration without changing user_version', async () => {
    const db = new NodeSqliteDriver();
    await db.exec('CREATE TABLE t (id TEXT)');
    await db.exec('PRAGMA user_version = 0');
    const broken = {
      version: 1,
      name: 'broken',
      statements: ['CREATE TABLE ok (id TEXT)', 'THIS IS NOT SQL'],
    };
    await expect(migrate(db, [broken])).rejects.toThrow();
    const version = await db.all('PRAGMA user_version');
    expect(Object.values(version[0]!)[0]).toBe(0);
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='ok'");
    expect(tables).toHaveLength(0);
    db.close();
  });
});

describe('events repository', () => {
  it('creates, lists and expands recurring events', async () => {
    const {db} = await freshDb();
    const start = wallClockToUtc({year: 2026, month: 5, day: 4, hour: 9, minute: 0}, TZ);
    await createEvent(db, {
      title: 'Standup',
      start,
      end: start + 15 * 60_000,
      timezone: TZ,
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4',
    });
    const occurrences = await listOccurrences(
      db,
      wallClockToUtc({year: 2026, month: 5, day: 1, hour: 0, minute: 0}, TZ),
      wallClockToUtc({year: 2026, month: 5, day: 31, hour: 0, minute: 0}, TZ),
    );
    expect(occurrences).toHaveLength(4);
    expect(occurrences[0]!.title).toBe('Standup');
    db.close();
  });

  it('rejects an event that ends before it starts', async () => {
    const {db} = await freshDb();
    await expect(
      createEvent(db, {title: 'Bad', start: 1000, end: 500, timezone: TZ}),
    ).rejects.toThrow(/end before/);
    db.close();
  });

  it('moves a single instance without touching the series', async () => {
    const {db} = await freshDb();
    const start = wallClockToUtc({year: 2026, month: 5, day: 4, hour: 9, minute: 0}, TZ);
    const series = await createEvent(db, {
      title: 'Standup',
      start,
      end: start + 15 * 60_000,
      timezone: TZ,
      rrule: 'FREQ=DAILY;COUNT=3',
    });
    const second = start + 86_400_000;
    await overrideOccurrence(db, series.id, second, {start: second + 3_600_000, end: second + 3_600_000 + 15 * 60_000});
    const occurrences = await listOccurrences(db, start - 86_400_000, start + 4 * 86_400_000);
    expect(occurrences).toHaveLength(3);
    expect(occurrences[1]!.start).toBe(second + 3_600_000);
    expect(occurrences[0]!.start).toBe(start);
    db.close();
  });

  it('cancels a single instance and keeps the rest', async () => {
    const {db} = await freshDb();
    const start = wallClockToUtc({year: 2026, month: 5, day: 4, hour: 9, minute: 0}, TZ);
    const series = await createEvent(db, {
      title: 'Standup',
      start,
      end: start + 15 * 60_000,
      timezone: TZ,
      rrule: 'FREQ=DAILY;COUNT=3',
    });
    await deleteEvent(db, series.id, {scope: 'occurrence', occurrenceStart: start + 86_400_000});
    const occurrences = await listOccurrences(db, start - 86_400_000, start + 4 * 86_400_000);
    expect(occurrences.map(o => o.start)).toEqual([start, start + 2 * 86_400_000]);
    db.close();
  });
});

describe('tasks repository', () => {
  it('completes a recurring task and schedules the next instance', async () => {
    const {db} = await freshDb();
    const due = wallClockToUtc({year: 2026, month: 5, day: 4, hour: 17, minute: 0}, TZ);
    const task = await createTask(db, {
      title: 'Water plants',
      dueAt: due,
      dueHasTime: true,
      recurrence: 'FREQ=WEEKLY;INTERVAL=1',
    });
    const result = await completeTask(db, task.id);
    expect(result.task.completedAt).not.toBeNull();
    expect(result.nextTask).not.toBeNull();
    expect(result.nextTask!.dueAt).toBe(due + 7 * 86_400_000);
    db.close();
  });

  it('buckets tasks by local due date', async () => {
    const {db} = await freshDb();
    const now = wallClockToUtc({year: 2026, month: 5, day: 4, hour: 10, minute: 0}, TZ);
    await createTask(db, {title: 'Overdue', dueAt: now - 86_400_000});
    await createTask(db, {title: 'Today', dueAt: now + 3_600_000});
    await createTask(db, {title: 'Later', dueAt: now + 3 * 86_400_000});
    await createTask(db, {title: 'Someday'});
    const tasks = await listTasks(db);
    const buckets = bucketTasks(tasks, now, TZ);
    expect(buckets.overdue.map(t => t.title)).toEqual(['Overdue']);
    expect(buckets.today.map(t => t.title)).toEqual(['Today']);
    expect(buckets.upcoming.map(t => t.title)).toEqual(['Later']);
    expect(buckets.someday.map(t => t.title)).toEqual(['Someday']);
    db.close();
  });

  it('soft deletes and restores tasks', async () => {
    const {db} = await freshDb();
    const task = await createTask(db, {title: 'Temporary'});
    const ids = await deleteTask(db, task.id);
    expect(await listTasks(db)).toHaveLength(0);
    await restoreTasks(db, ids);
    expect(await listTasks(db)).toHaveLength(1);
    db.close();
  });
});

describe('habits, notes, reminders', () => {
  it('tracks habit logs and streaks', async () => {
    const {db} = await freshDb();
    const habit = await createHabit(db, {name: 'Read', schedule: [1, 2, 3, 4, 5]});
    for (const date of ['2026-05-01', '2026-05-04', '2026-05-05']) {
      await setHabitLog(db, habit.id, date, true);
    }
    const logs = await listHabitLogs(db, '2026-05-01', '2026-05-10');
    expect(logs).toHaveLength(3);
    const progress = computeHabitProgress(
      habit.schedule,
      habit.targetPerWeek,
      logs.map(l => l.date),
      '2026-05-05',
    );
    expect(progress.streak).toBe(2);
    expect(progress.completedThisWeek).toBe(2);
    // Unchecking removes the row rather than leaving value = 0.
    await setHabitLog(db, habit.id, '2026-05-05', false);
    expect(await listHabitLogs(db, '2026-05-01', '2026-05-10')).toHaveLength(2);
    db.close();
  });

  it('creates and updates journal notes by date', async () => {
    const {db} = await freshDb();
    await createNote(db, {title: 'Ideas', body: 'Ship the offline calendar'});
    const journal = await upsertJournal(db, '2026-05-04', 'First entry');
    const updated = await upsertJournal(db, '2026-05-04', 'Edited entry');
    expect(updated.id).toBe(journal.id);
    const notes = await listNotes(db);
    expect(notes).toHaveLength(2);
    expect(await listNotes(db, {journal: true})).toHaveLength(1);
    db.close();
  });

  it('finds reminders due in a window', async () => {
    const {db} = await freshDb();
    const now = Date.UTC(2026, 4, 4, 12, 0);
    await createReminder(db, {kind: 'custom', title: 'Stretch', triggerAt: now + 60_000});
    await createReminder(db, {kind: 'custom', title: 'Later', triggerAt: now + 86_400_000});
    const due = await upcomingReminders(db, now, now + 3_600_000);
    expect(due.map(r => r.title)).toEqual(['Stretch']);
    db.close();
  });

  it('searches across events, tasks and notes', async () => {
    const {db} = await freshDb();
    await createEvent(db, {
      title: 'Design review',
      start: Date.UTC(2026, 4, 4, 13, 0),
      end: Date.UTC(2026, 4, 4, 14, 0),
      notes: 'Bring the design doc',
    });
    await createTask(db, {title: 'Review designs'});
    await createNote(db, {title: 'Design notes', body: 'Colours and type'});
    const hits = await search(db, 'design');
    expect(hits.map(h => h.kind).sort()).toEqual(['event', 'note', 'task']);
    db.close();
  });
});

describe('settings, layout and undo', () => {
  it('persists settings with defaults for unknown keys', async () => {
    const {db} = await freshDb();
    const defaults = await getSettings(db);
    expect(defaults.theme).toBe('system');
    await setSetting(db, 'theme', 'dark');
    await setSetting(db, 'weekStartsOn', 0);
    const updated = await getSettings(db);
    expect(updated.theme).toBe('dark');
    expect(updated.weekStartsOn).toBe(0);
    db.close();
  });

  it('restores soft-deleted rows through the undo log', async () => {
    const {db} = await freshDb();
    const note = await createNote(db, {title: 'Draft', body: 'text'});
    await db.run('UPDATE notes SET deleted_at = ? WHERE id = ?', [Date.now(), note.id]);
    const entry = await recordUndo(db, 'Delete note', {restore: [{table: 'notes', ids: [note.id]}]});
    expect(await listNotes(db)).toHaveLength(0);
    expect(await applyUndo(db, entry.token)).toBe(true);
    expect(await listNotes(db)).toHaveLength(1);
    expect(await applyUndo(db, entry.token)).toBe(false);
    db.close();
  });

  it('rejects undo payloads that reference unknown tables', async () => {
    const {db} = await freshDb();
    await expect(
      recordUndo(db, 'evil', {restore: [{table: 'sqlite_master', ids: ['x']}]}),
    ).rejects.toThrow(/not undoable/);
    db.close();
  });
});

describe('domain projections', () => {
  it('detects overlapping events but not back-to-back ones', () => {
    const base = {
      eventId: 'e',
      title: 'x',
      allDay: false,
      color: '#000',
      location: null,
      notes: null,
      timezone: TZ,
      occurrenceStart: 0,
      recurring: false,
      isOverride: false,
    };
    const conflicts = findConflicts([
      {...base, start: 1000, end: 2000},
      {...base, start: 2000, end: 3000},
      {...base, start: 1500, end: 2500},
    ]);
    expect(conflicts).toHaveLength(2);
  });

  it('finds free slots inside working hours', async () => {
    const day = wallClockToUtc({year: 2026, month: 5, day: 4, hour: 12, minute: 0}, TZ);
    const occ = (hour: number, minutes: number) => {
      const start = wallClockToUtc({year: 2026, month: 5, day: 4, hour, minute: 0}, TZ);
      return {
        eventId: 'e',
        title: 'Meeting',
        start,
        end: start + minutes * 60_000,
        allDay: false,
        color: '#000',
        location: null,
        notes: null,
        timezone: TZ,
        occurrenceStart: start,
        recurring: false,
        isOverride: false,
      };
    };
    const slots = findFreeSlots([occ(10, 60), occ(13, 90)], day, TZ, {
      workdayStart: 9 * 60,
      workdayEnd: 18 * 60,
      minMinutes: 30,
    });
    // 09:00-10:00, 11:00-13:00 and 14:30-18:00 are free.
    expect(slots.map(s => s.minutes)).toEqual([60, 120, 210]);
    expect(localDateKey(slots[0]!.start, TZ)).toBe('2026-05-04');
  });
});
