import type {SqlDriver} from '../db/driver';
import type {ID, Note, Notebook} from '../domain/types';
import {newId, toNote, toNotebook} from './mappers';

export async function listNotebooks(db: SqlDriver): Promise<Notebook[]> {
  const rows = await db.all('SELECT * FROM notebooks ORDER BY name COLLATE NOCASE ASC');
  return rows.map(toNotebook);
}

export async function createNotebook(
  db: SqlDriver,
  name: string,
  color = '#6F7F63',
  now = Date.now(),
): Promise<Notebook> {
  if (!name.trim()) {
    throw new Error('Notebook name is required');
  }
  const id = newId('nb');
  await db.run('INSERT INTO notebooks (id, name, color, created_at) VALUES (?,?,?,?)', [
    id,
    name.trim(),
    color,
    now,
  ]);
  const rows = await db.all('SELECT * FROM notebooks WHERE id = ?', [id]);
  return toNotebook(rows[0]!);
}

export interface NoteQuery {
  notebookId?: ID | null;
  pinnedOnly?: boolean;
  journal?: boolean;
  search?: string;
  limit?: number;
}

export async function listNotes(db: SqlDriver, query: NoteQuery = {}): Promise<Note[]> {
  const clauses = ['deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (query.notebookId !== undefined) {
    if (query.notebookId === null) {
      clauses.push('notebook_id IS NULL');
    } else {
      clauses.push('notebook_id = ?');
      params.push(query.notebookId);
    }
  }
  if (query.pinnedOnly) {
    clauses.push('pinned = 1');
  }
  if (query.journal) {
    clauses.push('journal_date IS NOT NULL');
  }
  if (query.search) {
    clauses.push('(title LIKE ? OR body LIKE ? OR tags LIKE ?)');
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }
  const rows = await db.all(
    `SELECT * FROM notes WHERE ${clauses.join(' AND ')}
     ORDER BY pinned DESC, updated_at DESC LIMIT ?`,
    [...params, query.limit ?? 200],
  );
  return rows.map(toNote);
}

export async function getNote(db: SqlDriver, id: ID): Promise<Note | null> {
  const rows = await db.all('SELECT * FROM notes WHERE id = ?', [id]);
  return rows[0] ? toNote(rows[0]) : null;
}

export async function getNoteByJournalDate(db: SqlDriver, date: string): Promise<Note | null> {
  const rows = await db.all('SELECT * FROM notes WHERE journal_date = ? AND deleted_at IS NULL', [date]);
  return rows[0] ? toNote(rows[0]) : null;
}

export interface NoteInput {
  title: string;
  body?: string;
  notebookId?: ID | null;
  tags?: string[];
  pinned?: boolean;
  journalDate?: string | null;
}

function deriveTitle(title: string, body: string): string {
  if (title.trim()) {
    return title.trim();
  }
  const firstLine = body.trim().split('\n')[0] ?? '';
  return firstLine.slice(0, 80) || 'Untitled note';
}

export async function createNote(db: SqlDriver, input: NoteInput, now = Date.now()): Promise<Note> {
  const body = input.body ?? '';
  const id = newId('note');
  await db.run(
    `INSERT INTO notes (id, title, body, notebook_id, tags, pinned, journal_date, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,
      deriveTitle(input.title, body),
      body,
      input.notebookId ?? null,
      JSON.stringify(input.tags ?? []),
      input.pinned ?? false,
      input.journalDate ?? null,
      now,
      now,
    ],
  );
  const created = await getNote(db, id);
  if (!created) {
    throw new Error('Note insert failed');
  }
  return created;
}

export interface NotePatch {
  title?: string;
  body?: string;
  notebookId?: ID | null;
  tags?: string[];
  pinned?: boolean;
}

export async function updateNote(
  db: SqlDriver,
  id: ID,
  patch: NotePatch,
  now = Date.now(),
): Promise<Note> {
  const existing = await getNote(db, id);
  if (!existing) {
    throw new Error('Note not found');
  }
  const next = {...existing, ...patch};
  await db.run(
    `UPDATE notes SET title=?, body=?, notebook_id=?, tags=?, pinned=?, updated_at=? WHERE id=?`,
    [
      deriveTitle(next.title, next.body),
      next.body,
      next.notebookId,
      JSON.stringify(next.tags),
      next.pinned,
      now,
      id,
    ],
  );
  const updated = await getNote(db, id);
  if (!updated) {
    throw new Error('Note update failed');
  }
  return updated;
}

/** Creates or updates the daily journal note for a local date. */
export async function upsertJournal(
  db: SqlDriver,
  date: string,
  body: string,
  now = Date.now(),
): Promise<Note> {
  const existing = await getNoteByJournalDate(db, date);
  if (existing) {
    return updateNote(db, existing.id, {body}, now);
  }
  return createNote(db, {title: `Journal · ${date}`, body, journalDate: date}, now);
}

export async function deleteNote(db: SqlDriver, id: ID, now = Date.now()): Promise<ID[]> {
  const existing = await getNote(db, id);
  if (!existing) {
    throw new Error('Note not found');
  }
  await db.run('UPDATE notes SET deleted_at = ? WHERE id = ?', [now, id]);
  return [id];
}

export async function restoreNotes(db: SqlDriver, ids: readonly ID[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const placeholders = ids.map(() => '?').join(',');
  await db.run(`UPDATE notes SET deleted_at = NULL WHERE id IN (${placeholders})`, [...ids]);
}

export async function allTags(db: SqlDriver): Promise<string[]> {
  const rows = await db.all('SELECT tags FROM notes WHERE deleted_at IS NULL');
  const tags = new Set<string>();
  for (const row of rows) {
    try {
      const parsed: unknown = JSON.parse(String(row.tags ?? '[]'));
      if (Array.isArray(parsed)) {
        for (const tag of parsed) {
          if (typeof tag === 'string' && tag.trim()) {
            tags.add(tag.trim());
          }
        }
      }
    } catch {
      // ignore malformed tag payloads
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}
