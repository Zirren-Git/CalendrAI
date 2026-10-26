/** Human-facing date and number formatting shared by screens and widgets. */
import {
  addDaysToDateKey,
  formatDateKey,
  formatDuration,
  formatTime,
  localDateKey,
  parseDateKey,
  weekdayOfDateKey,
} from '../domain/time';

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function timeOfDay(ms: number, timeZone: string, clock24h: boolean): string {
  return formatTime(ms, timeZone, clock24h);
}

export function dayLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) {
    return 'Today';
  }
  if (dateKey === addDaysToDateKey(todayKey, 1)) {
    return 'Tomorrow';
  }
  if (dateKey === addDaysToDateKey(todayKey, -1)) {
    return 'Yesterday';
  }
  const weekday = WEEKDAY_SHORT[weekdayOfDateKey(dateKey)] ?? '';
  return `${weekday} ${formatDateKey(dateKey, 'short')}`;
}

/** "9:00 – 10:30", or "All day". */
export function eventTimeLabel(
  start: number,
  end: number,
  allDay: boolean,
  timeZone: string,
  clock24h: boolean,
): string {
  if (allDay) {
    return 'All day';
  }
  return `${formatTime(start, timeZone, clock24h)} – ${formatTime(end, timeZone, clock24h)}`;
}

export function reminderLabel(minutes: number): string {
  if (minutes === 0) {
    return 'At start';
  }
  if (minutes < 60) {
    return `${minutes} min before`;
  }
  if (minutes % 60 === 0) {
    return `${minutes / 60} h before`;
  }
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min before`;
}

export function minutesLabel(minutes: number): string {
  return formatDuration(minutes);
}

export function relativeDay(ms: number, now: number, timeZone: string): string {
  const key = localDateKey(ms, timeZone);
  const todayKey = localDateKey(now, timeZone);
  const tomorrow = addDaysToDateKey(todayKey, 1);
  if (key === todayKey) {
    return 'Today';
  }
  if (key === tomorrow) {
    return 'Tomorrow';
  }
  return dayLabel(key, todayKey);
}

export function monthTitle(dateKey: string): string {
  const parts = parseDateKey(dateKey);
  return `${MONTH_SHORT[parts.month - 1]} ${parts.year}`;
}

export function weekdayName(index: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index] ?? '';
}

export function clockLabel(hour: number, minute: number, clock24h: boolean): string {
  if (clock24h) {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

export function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function shortDate(ms: number, timeZone: string): string {
  return formatDateKey(localDateKey(ms, timeZone), 'short');
}
