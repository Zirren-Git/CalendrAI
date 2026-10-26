import type {SqlDriver} from '../db/driver';
import {asNumber, asString} from '../db/driver';
import type {SearchHit} from '../domain/types';

export interface SearchOptions {
  limitPerKind?: number;
  now?: number;
}

function snippet(text: string, needle: string, radius = 48): string {
  const lower = text.toLowerCase();
  const index = lower.indexOf(needle.toLowerCase());
  if (index < 0) {
    return text.slice(0, radius * 2).trim();
  }
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + needle.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/**
 * Local search over events, tasks and notes. Uses LIKE over indexed columns
 * rather than an FTS table, because FTS5 availability depends on the SQLite
 * build shipped with the app.
 */
export async function search(
  db: SqlDriver,
  query: string,
  options: SearchOptions = {},
): Promise<SearchHit[]> {
  const needle = query.trim();
  if (needle.length < 1) {
    return [];
  }
  const like = `%${needle}%`;
  const limit = options.limitPerKind ?? 20;
  const now = options.now ?? Date.now();

  const [eventRows, taskRows, noteRows] = await Promise.all([
    db.all(
      `SELECT id, title, COALESCE(location, '') AS location, COALESCE(notes, '') AS notes, start_at
       FROM events
       WHERE deleted_at IS NULL AND (title LIKE ? OR location LIKE ? OR notes LIKE ?)
       ORDER BY ABS(start_at - ?) ASC LIMIT ?`,
      [like, like, like, now, limit],
    ),
    db.all(
      `SELECT id, title, COALESCE(notes, '') AS notes, updated_at
       FROM tasks
       WHERE deleted_at IS NULL AND (title LIKE ? OR notes LIKE ?)
       ORDER BY completed_at IS NOT NULL, updated_at DESC LIMIT ?`,
      [like, like, limit],
    ),
    db.all(
      `SELECT id, title, body, updated_at
       FROM notes
       WHERE deleted_at IS NULL AND (title LIKE ? OR body LIKE ? OR tags LIKE ?)
       ORDER BY pinned DESC, updated_at DESC LIMIT ?`,
      [like, like, like, limit],
    ),
  ]);

  const hits: SearchHit[] = [];
  for (const row of eventRows) {
    const title = asString(row.title);
    const detail = [asString(row.location), asString(row.notes)].filter(Boolean).join(' · ');
    hits.push({
      kind: 'event',
      id: asString(row.id),
      title,
      snippet: detail ? snippet(detail, needle) : '',
      timestamp: asNumber(row.start_at),
    });
  }
  for (const row of taskRows) {
    hits.push({
      kind: 'task',
      id: asString(row.id),
      title: asString(row.title),
      snippet: snippet(asString(row.notes), needle),
      timestamp: asNumber(row.updated_at),
    });
  }
  for (const row of noteRows) {
    hits.push({
      kind: 'note',
      id: asString(row.id),
      title: asString(row.title),
      snippet: snippet(asString(row.body), needle),
      timestamp: asNumber(row.updated_at),
    });
  }
  return hits.sort((a, b) => b.timestamp - a.timestamp);
}
