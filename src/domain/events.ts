import type {Occurrence} from './types';
import {atLocalMinute, localDayRange, zonedParts} from './time';

export interface Conflict {
  a: Occurrence;
  b: Occurrence;
}

/** Overlapping (not merely touching) occurrences, all-day events excluded. */
export function findConflicts(occurrences: readonly Occurrence[]): Conflict[] {
  const timed = occurrences
    .filter(o => !o.allDay)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const conflicts: Conflict[] = [];
  for (let i = 0; i < timed.length; i += 1) {
    const a = timed[i]!;
    for (let j = i + 1; j < timed.length; j += 1) {
      const b = timed[j]!;
      if (b.start >= a.end) {
        break;
      }
      if (b.start < a.end && b.end > a.start) {
        conflicts.push({a, b});
      }
    }
  }
  return conflicts;
}

export interface FreeSlot {
  start: number;
  end: number;
  minutes: number;
}

export interface FreeTimeOptions {
  /** Local minutes from midnight, inclusive. */
  workdayStart?: number;
  workdayEnd?: number;
  minMinutes?: number;
  /** Extra padding to leave between the slot and the surrounding events. */
  bufferMinutes?: number;
}

/**
 * Finds gaps between timed events inside working hours for a single local day.
 * All-day events are ignored (they annotate the day, they do not occupy it).
 */
export function findFreeSlots(
  occurrences: readonly Occurrence[],
  dayAnchor: number,
  timeZone: string,
  options: FreeTimeOptions = {},
): FreeSlot[] {
  const range = localDayRange(dayAnchor, timeZone);
  const dayStartMinute = options.workdayStart ?? 9 * 60;
  const dayEndMinute = options.workdayEnd ?? 18 * 60;
  const minMinutes = options.minMinutes ?? 30;
  const buffer = (options.bufferMinutes ?? 0) * 60_000;

  const windowStart = atLocalMinute(dayAnchor, timeZone, dayStartMinute);
  const windowEnd = atLocalMinute(dayAnchor, timeZone, dayEndMinute);
  if (windowEnd <= windowStart) {
    return [];
  }

  const busy = occurrences
    .filter(o => !o.allDay && o.end > windowStart && o.start < windowEnd && o.start <= range.end && o.end >= range.start)
    .map(o => ({start: Math.max(o.start, windowStart), end: Math.min(o.end, windowEnd)}))
    .sort((a, b) => a.start - b.start);

  const merged: {start: number; end: number}[] = [];
  for (const block of busy) {
    const last = merged[merged.length - 1];
    if (last && block.start <= last.end) {
      last.end = Math.max(last.end, block.end);
    } else {
      merged.push({...block});
    }
  }

  const slots: FreeSlot[] = [];
  let cursor = windowStart;
  for (const block of merged) {
    const gapEnd = block.start - buffer;
    if (gapEnd - cursor >= minMinutes * 60_000) {
      slots.push({start: cursor, end: gapEnd, minutes: Math.floor((gapEnd - cursor) / 60_000)});
    }
    cursor = Math.max(cursor, block.end + buffer);
  }
  if (windowEnd - cursor >= minMinutes * 60_000) {
    slots.push({start: cursor, end: windowEnd, minutes: Math.floor((windowEnd - cursor) / 60_000)});
  }
  return slots;
}

/** Local hour of the day with the most scheduled minutes, for heatmaps. */
export function busiestHours(
  occurrences: readonly Occurrence[],
  timeZone: string,
): {hour: number; minutes: number}[] {
  const buckets = new Array(24).fill(0) as number[];
  for (const occurrence of occurrences) {
    if (occurrence.allDay) {
      continue;
    }
    let cursor = occurrence.start;
    while (cursor < occurrence.end) {
      const parts = zonedParts(cursor, timeZone);
      const nextHour = Math.min(
        occurrence.end,
        cursor + (60 - parts.minute) * 60_000 - parts.second * 1000,
      );
      buckets[parts.hour] = (buckets[parts.hour] ?? 0) + (nextHour - cursor) / 60_000;
      cursor = nextHour;
    }
  }
  return buckets.map((minutes, hour) => ({hour, minutes: Math.round(minutes)}));
}
