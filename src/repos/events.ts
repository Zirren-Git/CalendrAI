import type {SqlDriver} from '../db/driver';
import {asString} from '../db/driver';
import {expandEvent, parseRRule} from '../domain/recurrence';
import type {
  CalendarEvent,
  EventException,
  EventInput,
  ID,
  Occurrence,
  Reminder,
} from '../domain/types';
import {newId, toEvent, toException, toReminder} from './mappers';

export interface EventQuery {
  rangeStart: number;
  rangeEnd: number;
  /** Include soft-deleted records (used by backup/export and undo). */
  includeDeleted?: boolean;
  timeZone?: string;
}

export interface DeleteEventOptions {
  /** `series` removes every instance, `occurrence` only one. */
  scope: 'series' | 'occurrence';
  occurrenceStart?: number;
}

export async function getEvent(db: SqlDriver, id: ID): Promise<CalendarEvent | null> {
  const rows = await db.all('SELECT * FROM events WHERE id = ?', [id]);
  return rows[0] ? toEvent(rows[0]) : null;
}

export async function createEvent(
  db: SqlDriver,
  input: EventInput,
  now = Date.now(),
): Promise<CalendarEvent> {
  if (!input.title.trim()) {
    throw new Error('Event title is required');
  }
  if (!Number.isFinite(input.start) || !Number.isFinite(input.end)) {
    throw new Error('Event start and end must be valid timestamps');
  }
  if (input.end < input.start) {
    throw new Error('Event cannot end before it starts');
  }
  if (input.rrule) {
    // Validate before persisting: a malformed rule would silently produce no
    // occurrences later.
    parseRRule(input.rrule);
  }
  const id = newId('evt');
  await db.run(
    `INSERT INTO events
       (id, title, location, notes, start_at, end_at, all_day, timezone, color,
        attendees, rrule, exception_parent_id, occurrence_original_start, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.title.trim(),
      input.location ?? null,
      input.notes ?? null,
      input.start,
      input.end,
      input.allDay ?? false,
      input.timezone ?? 'UTC',
      input.color ?? '#C25E3A',
      JSON.stringify(input.attendees ?? []),
      input.rrule ?? null,
      null,
      null,
      now,
      now,
    ],
  );
  const created = await getEvent(db, id);
  if (!created) {
    throw new Error('Event insert failed');
  }
  return created;
}

export interface EventPatch {
  title?: string;
  location?: string | null;
  notes?: string | null;
  start?: number;
  end?: number;
  allDay?: boolean;
  timezone?: string;
  color?: string;
  attendees?: string[];
  rrule?: string | null;
}

export async function updateEvent(
  db: SqlDriver,
  id: ID,
  patch: EventPatch,
  now = Date.now(),
): Promise<CalendarEvent> {
  const existing = await getEvent(db, id);
  if (!existing) {
    throw new Error('Event not found');
  }
  const next: CalendarEvent = {...existing, ...patch, updatedAt: now};
  if (next.title.trim() === '') {
    throw new Error('Event title is required');
  }
  if (next.end < next.start) {
    throw new Error('Event cannot end before it starts');
  }
  if (patch.rrule) {
    parseRRule(patch.rrule);
  }
  await db.run(
    `UPDATE events SET title=?, location=?, notes=?, start_at=?, end_at=?, all_day=?,
       timezone=?, color=?, attendees=?, rrule=?, updated_at=? WHERE id=?`,
    [
      next.title.trim(),
      next.location,
      next.notes,
      next.start,
      next.end,
      next.allDay,
      next.timezone,
      next.color,
      JSON.stringify(next.attendees),
      next.rrule,
      now,
      id,
    ],
  );
  const updated = await getEvent(db, id);
  if (!updated) {
    throw new Error('Event update failed');
  }
  return updated;
}

/**
 * Moves a single instance of a recurring event by materialising an override row.
 * The parent series is untouched, so other instances keep their time.
 */
export async function overrideOccurrence(
  db: SqlDriver,
  parentId: ID,
  occurrenceStart: number,
  patch: EventPatch,
  now = Date.now(),
): Promise<CalendarEvent> {
  const parent = await getEvent(db, parentId);
  if (!parent) {
    throw new Error('Event not found');
  }
  if (!parent.rrule) {
    return updateEvent(db, parentId, patch, now);
  }
  return db.transaction(async tx => {
    const existing = await tx.all(
      'SELECT override_event_id FROM event_exceptions WHERE event_id = ? AND occurrence_start = ?',
      [parentId, occurrenceStart],
    );
    const existingOverrideId = existing[0]
      ? (existing[0].override_event_id as string | null)
      : null;
    let overrideId = existingOverrideId;
    if (overrideId) {
      await updateEvent(tx, overrideId, patch, now);
    } else {
      const duration = parent.end - parent.start;
      const created = await createEvent(
        tx,
        {
          title: patch.title ?? parent.title,
          start: patch.start ?? occurrenceStart,
          end: patch.end ?? (patch.start ?? occurrenceStart) + duration,
          allDay: patch.allDay ?? parent.allDay,
          timezone: patch.timezone ?? parent.timezone,
          location: patch.location ?? parent.location,
          notes: patch.notes ?? parent.notes,
          color: patch.color ?? parent.color,
          attendees: patch.attendees ?? parent.attendees,
        },
        now,
      );
      overrideId = created.id;
      await tx.run(
        'UPDATE events SET exception_parent_id = ?, occurrence_original_start = ? WHERE id = ?',
        [parentId, occurrenceStart, overrideId],
      );
      await tx.run(
        `INSERT INTO event_exceptions (id, event_id, occurrence_start, cancelled, override_event_id, created_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(event_id, occurrence_start)
         DO UPDATE SET cancelled = 0, override_event_id = excluded.override_event_id`,
        [newId('exc'), parentId, occurrenceStart, false, overrideId, now],
      );
    }
    const row = await tx.all('SELECT * FROM events WHERE id = ?', [overrideId]);
    return toEvent(row[0]!);
  });
}

/** Cancels one instance of a series without deleting the series. */
export async function cancelOccurrence(
  db: SqlDriver,
  parentId: ID,
  occurrenceStart: number,
  now = Date.now(),
): Promise<void> {
  await db.run(
    `INSERT INTO event_exceptions (id, event_id, occurrence_start, cancelled, override_event_id, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(event_id, occurrence_start)
     DO UPDATE SET cancelled = 1, override_event_id = NULL`,
    [newId('exc'), parentId, occurrenceStart, true, null, now],
  );
}

export interface DeleteResult {
  deletedIds: ID[];
  undoToken: string;
}

export async function deleteEvent(
  db: SqlDriver,
  id: ID,
  options: DeleteEventOptions,
  now = Date.now(),
): Promise<DeleteResult> {
  const event = await getEvent(db, id);
  if (!event) {
    throw new Error('Event not found');
  }
  if (event.rrule && options.scope === 'occurrence') {
    const occurrenceStart = options.occurrenceStart ?? event.start;
    await cancelOccurrence(db, id, occurrenceStart, now);
    return {deletedIds: [id], undoToken: ''};
  }
  const deletedIds: ID[] = [id];
  await db.transaction(async tx => {
    await tx.run('UPDATE events SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [now, id]);
    if (event.exceptionParentId) {
      // Removing a modified instance means that occurrence disappears from the
      // series, so mark it cancelled instead of resurrecting the original time.
      await tx.run(
        `UPDATE event_exceptions SET cancelled = 1, override_event_id = NULL
         WHERE event_id = ? AND override_event_id = ?`,
        [event.exceptionParentId, id],
      );
    } else {
      // Deleting a series also retires every materialised override it owns.
      const overrides = await tx.all(
        'SELECT id FROM events WHERE exception_parent_id = ? AND deleted_at IS NULL',
        [id],
      );
      for (const row of overrides) {
        const overrideId = asString(row.id);
        await tx.run('UPDATE events SET deleted_at = ? WHERE id = ?', [now, overrideId]);
        deletedIds.push(overrideId);
      }
    }
    await tx.run(
      'UPDATE reminders SET dismissed_at = ? WHERE kind = ? AND source_id = ? AND dismissed_at IS NULL',
      [now, 'event', id],
    );
  });
  return {deletedIds, undoToken: ''};
}

export async function listEvents(
  db: SqlDriver,
  query: EventQuery,
): Promise<CalendarEvent[]> {
  const rows = await db.all(
    `SELECT * FROM events
     WHERE ${query.includeDeleted ? '1=1' : 'deleted_at IS NULL'}
       AND (
         (rrule IS NOT NULL AND exception_parent_id IS NULL)
         OR (start_at <= ? AND end_at >= ?)
       )
     ORDER BY start_at ASC`,
    [query.rangeEnd, query.rangeStart],
  );
  return rows.map(toEvent);
}

export async function listAllEvents(db: SqlDriver, includeDeleted = false): Promise<CalendarEvent[]> {
  const rows = await db.all(
    `SELECT * FROM events ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY start_at ASC`,
  );
  return rows.map(toEvent);
}

export async function listExceptions(
  db: SqlDriver,
  eventIds: readonly ID[],
): Promise<EventException[]> {
  if (eventIds.length === 0) {
    return [];
  }
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT * FROM event_exceptions WHERE event_id IN (${placeholders})`,
    [...eventIds],
  );
  return rows.map(toException);
}

/**
 * Returns every occurrence overlapping the range, with recurrence expanded,
 * cancellations applied and modified instances substituted.
 */
export async function listOccurrences(
  db: SqlDriver,
  rangeStart: number,
  rangeEnd: number,
  limit = 2000,
): Promise<Occurrence[]> {
  const events = await listEvents(db, {rangeStart, rangeEnd});
  const parents = events.filter(event => event.rrule && !event.exceptionParentId);
  const overrides = events.filter(event => event.exceptionParentId);
  const exceptions = await listExceptions(
    db,
    parents.map(p => p.id),
  );
  const all: Occurrence[] = [];
  for (const event of events) {
    if (event.exceptionParentId && !event.rrule) {
      // Overrides are returned through their parent's expansion.
      continue;
    }
    const expanded = expandEvent(event, {
      rangeStart,
      rangeEnd,
      exceptions: exceptions.filter(e => e.eventId === event.id),
      overrides: overrides.filter(o => o.exceptionParentId === event.id),
      limit,
    });
    all.push(...expanded);
  }
  return all.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

export async function addEventReminder(
  db: SqlDriver,
  eventId: ID,
  triggerAt: number,
  title: string,
  minutesBefore: number,
  now = Date.now(),
): Promise<Reminder> {
  const id = newId('rem');
  await db.run(
    `INSERT INTO reminders (id, kind, source_id, title, body, trigger_at, fired_at, dismissed_at, created_at)
     VALUES (?,?,?,?,?,?,NULL,NULL,?)`,
    [id, 'event', eventId, title, `${minutesBefore} minutes before`, triggerAt, now],
  );
  const rows = await db.all('SELECT * FROM reminders WHERE id = ?', [id]);
  return toReminder(rows[0]!);
}

export async function getEventReminders(db: SqlDriver, eventId: ID): Promise<Reminder[]> {
  const rows = await db.all(
    'SELECT * FROM reminders WHERE kind = ? AND source_id = ? ORDER BY trigger_at ASC',
    ['event', eventId],
  );
  return rows.map(toReminder);
}
