import type {SqlDriver} from '../db/driver';
import {listOccurrences} from './events';
import {addDaysToDateKey, localDateKey, parseDateKey, wallClockToUtc} from '../domain/time';

export interface OccurrenceCacheOptions {
  timeZone: string;
  daysAhead?: number;
  now?: number;
}

/**
 * Rebuilds the occurrence cache the Android launcher widgets read. Called after
 * any event change and on app start; the cache only ever holds a small window.
 */
export async function refreshOccurrenceCache(
  db: SqlDriver,
  options: OccurrenceCacheOptions,
): Promise<number> {
  const now = options.now ?? Date.now();
  const daysAhead = options.daysAhead ?? 30;
  const todayKey = localDateKey(now, options.timeZone);
  const fromKey = addDaysToDateKey(todayKey, -1);
  const toKey = addDaysToDateKey(todayKey, daysAhead);
  const fromParts = parseDateKey(fromKey);
  const toParts = parseDateKey(toKey);
  const rangeStart = wallClockToUtc(
    {year: fromParts.year, month: fromParts.month, day: fromParts.day, hour: 0, minute: 0},
    options.timeZone,
  );
  const rangeEnd = wallClockToUtc(
    {year: toParts.year, month: toParts.month, day: toParts.day, hour: 0, minute: 0},
    options.timeZone,
  );
  const occurrences = await listOccurrences(db, rangeStart, rangeEnd, 500);
  await db.transaction(async tx => {
    await tx.run('DELETE FROM occurrence_cache');
    for (const occurrence of occurrences) {
      await tx.run(
        `INSERT OR REPLACE INTO occurrence_cache
           (id, event_id, occurrence_start, title, start_at, end_at, all_day, color, refreshed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          `${occurrence.eventId}_${occurrence.occurrenceStart}`,
          occurrence.eventId,
          occurrence.occurrenceStart,
          occurrence.title,
          occurrence.start,
          occurrence.end,
          occurrence.allDay,
          occurrence.color,
          now,
        ],
      );
    }
  });
  return occurrences.length;
}
