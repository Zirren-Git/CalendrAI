/**
 * Local ICS (iCalendar) import/export. No network involved: the user picks a
 * file, the app reads it, and events land in the local calendar.
 *
 * Covers the subset the app models: VEVENT with DTSTART/DTEND/DURATION,
 * SUMMARY/DESCRIPTION/LOCATION, RRULE, UID and all-day dates. Unsupported
 * components (VTODO, VALARM, ...) are ignored and reported as warnings instead
 * of being silently dropped.
 */
import type {CalendarEvent, EventInput} from './types';
import {isValidTimeZone, wallClockToUtc, zonedParts} from './time';

export interface IcsWarning {
  line: number;
  message: string;
}

export interface IcsImportResult {
  events: EventInput[];
  warnings: IcsWarning[];
  skipped: number;
}

export interface IcsExportOptions {
  calendarName?: string;
  now?: number;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function unescapeText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '\\') {
      const next = value[i + 1];
      i += 1;
      if (next === 'n' || next === 'N') {
        out += '\n';
      } else if (next === undefined) {
        out += '\\';
      } else {
        out += next;
      }
    } else {
      out += char;
    }
  }
  return out;
}

/** RFC 5545 line folding at 75 octets (approximated per character). */
function foldLine(line: string): string {
  if (line.length <= 75) {
    return line;
  }
  const parts: string[] = [];
  let index = 0;
  parts.push(line.slice(0, 75));
  index = 75;
  while (index < line.length) {
    parts.push(` ${line.slice(index, index + 74)}`);
    index += 74;
  }
  return parts.join('\r\n');
}

function formatUtcStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function formatDateStamp(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${p.year}${pad(p.month)}${pad(p.day)}`;
}

export function exportIcs(events: readonly CalendarEvent[], options: IcsExportOptions = {}): string {
  const now = options.now ?? Date.now();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dayloom//Offline Calendar//EN',
    'CALSCALE:GREGORIAN',
  ];
  if (options.calendarName) {
    lines.push(`X-WR-CALNAME:${escapeText(options.calendarName)}`);
  }
  for (const event of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.id}@dayloom.local`);
    lines.push(`DTSTAMP:${formatUtcStamp(now)}`);
    lines.push(`LAST-MODIFIED:${formatUtcStamp(event.updatedAt || now)}`);
    if (event.allDay) {
      const startDate = formatDateStamp(event.start, event.timezone);
      const days = Math.max(1, Math.round((event.end - event.start) / 86_400_000));
      const endParts = zonedParts(event.start, event.timezone);
      const end = wallClockToUtc(
        {year: endParts.year, month: endParts.month, day: endParts.day, hour: 0, minute: 0},
        event.timezone,
      ) + days * 86_400_000;
      lines.push(`DTSTART;VALUE=DATE:${startDate}`);
      lines.push(`DTEND;VALUE=DATE:${formatDateStamp(end, event.timezone)}`);
    } else {
      lines.push(`DTSTART:${formatUtcStamp(event.start)}`);
      lines.push(`DTEND:${formatUtcStamp(event.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.location) {
      lines.push(`LOCATION:${escapeText(event.location)}`);
    }
    if (event.notes) {
      lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
    }
    if (event.attendees.length > 0) {
      lines.push(`ATTENDEE:${event.attendees.map(a => escapeText(a)).join(',')}`);
    }
    if (event.rrule) {
      lines.push(`RRULE:${event.rrule}`);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseProperty(raw: string): Property | null {
  // NAME;PARAM=VAL;PARAM2=VAL2:value — the colon separating value is the first
  // colon *outside* a quoted parameter value.
  let inQuotes = false;
  let colonIndex = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ':' && !inQuotes) {
      colonIndex = i;
      break;
    }
  }
  if (colonIndex < 0) {
    return null;
  }
  const head = raw.slice(0, colonIndex);
  const value = raw.slice(colonIndex + 1);
  const [name, ...paramParts] = head.split(';');
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
    }
  }
  return {name: (name ?? '').toUpperCase(), params, value};
}

function unfold(input: string): string[] {
  const rawLines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

interface ParsedDate {
  ms: number;
  allDay: boolean;
}

function parseIcsDate(prop: Property, fallbackZone: string): ParsedDate | null {
  const value = prop.value.trim();
  if (prop.params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }
    const zone = prop.params.TZID && isValidTimeZone(prop.params.TZID) ? prop.params.TZID : fallbackZone;
    return {
      ms: wallClockToUtc(
        {year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: 0, minute: 0},
        zone,
      ),
      allDay: true,
    };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!match) {
    return null;
  }
  const [, y, mo, d, h, mi, s, zulu] = match;
  const parts = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s),
  };
  if (zulu) {
    return {ms: Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second), allDay: false};
  }
  const zone = prop.params.TZID && isValidTimeZone(prop.params.TZID) ? prop.params.TZID : fallbackZone;
  return {ms: wallClockToUtc(parts, zone), allDay: false};
}

function parseDuration(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim().toUpperCase(),
  );
  if (!match) {
    return null;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const weeks = Number(match[2] ?? 0);
  const days = Number(match[3] ?? 0);
  const hours = Number(match[4] ?? 0);
  const minutes = Number(match[5] ?? 0);
  const seconds = Number(match[6] ?? 0);
  const ms =
    (((weeks * 7 + days) * 24 + hours) * 60 * 60 + minutes * 60 + seconds) * 1000;
  return sign * ms;
}

/**
 * Parses an ICS document into local event inputs. Invalid events are skipped
 * with a warning rather than aborting the whole import.
 */
export function importIcs(input: string, fallbackTimeZone: string): IcsImportResult {
  const lines = unfold(input);
  const zone = isValidTimeZone(fallbackTimeZone) ? fallbackTimeZone : 'UTC';
  const events: EventInput[] = [];
  const warnings: IcsWarning[] = [];
  let skipped = 0;
  let inEvent = false;
  let depth = 0;
  let current: {
    props: Property[];
    line: number;
  } | null = null;

  const flush = () => {
    if (!current) {
      return;
    }
    const props = current.props;
    const get = (name: string) => props.find(p => p.name === name);
    const startProp = get('DTSTART');
    if (!startProp) {
      warnings.push({line: current.line, message: 'Event has no DTSTART; skipped'});
      skipped += 1;
      current = null;
      return;
    }
    const start = parseIcsDate(startProp, zone);
    if (!start) {
      warnings.push({line: current.line, message: `Could not parse DTSTART "${startProp.value}"`});
      skipped += 1;
      current = null;
      return;
    }
    const endProp = get('DTEND');
    let end: number | null = null;
    if (endProp) {
      const parsed = parseIcsDate(endProp, zone);
      end = parsed ? parsed.ms : null;
    }
    if (end === null) {
      const durationProp = get('DURATION');
      const duration = durationProp ? parseDuration(durationProp.value) : null;
      end = start.ms + (duration ?? (start.allDay ? 86_400_000 : 60 * 60_000));
    }
    if (end < start.ms) {
      warnings.push({line: current.line, message: 'Event ends before it starts; skipped'});
      skipped += 1;
      current = null;
      return;
    }
    const summary = get('SUMMARY');
    const rruleProp = get('RRULE');
    events.push({
      title: summary ? unescapeText(summary.value) || 'Untitled event' : 'Untitled event',
      start: start.ms,
      end,
      allDay: start.allDay,
      timezone: startProp.params.TZID && isValidTimeZone(startProp.params.TZID)
        ? startProp.params.TZID
        : zone,
      location: get('LOCATION') ? unescapeText(get('LOCATION')!.value) : null,
      notes: get('DESCRIPTION') ? unescapeText(get('DESCRIPTION')!.value) : null,
      rrule: rruleProp ? rruleProp.value.trim() : null,
    });
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!.trim();
    if (raw === '') {
      continue;
    }
    if (raw === 'BEGIN:VEVENT') {
      inEvent = true;
      depth += 1;
      current = {props: [], line: index + 1};
      continue;
    }
    if (raw === 'END:VEVENT') {
      inEvent = false;
      depth = Math.max(0, depth - 1);
      flush();
      continue;
    }
    if (!inEvent) {
      continue;
    }
    const prop = parseProperty(raw);
    if (!prop) {
      warnings.push({line: index + 1, message: 'Malformed property line'});
      continue;
    }
    if (prop.name === 'BEGIN' || prop.name === 'END') {
      continue;
    }
    current?.props.push(prop);
  }
  if (inEvent) {
    warnings.push({line: lines.length, message: 'Unterminated VEVENT; ignored'});
    skipped += 1;
  }
  return {events, warnings, skipped};
}
