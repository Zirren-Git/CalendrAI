import type {SqlDriver} from '../db/driver';
import {asNumber} from '../db/driver';
import {localDateKey} from '../domain/time';
import {parseRRule} from '../domain/recurrence';
import type {ID, Task, TaskInput, TaskPriority} from '../domain/types';
import {newId, toTask} from './mappers';

export interface TaskFilter {
  projectId?: ID | null;
  includeCompleted?: boolean;
  parentId?: ID | null;
  search?: string;
  limit?: number;
}

export async function getTask(db: SqlDriver, id: ID): Promise<Task | null> {
  const rows = await db.all('SELECT * FROM tasks WHERE id = ?', [id]);
  return rows[0] ? toTask(rows[0]) : null;
}

export async function listTasks(db: SqlDriver, filter: TaskFilter = {}): Promise<Task[]> {
  const clauses = ['deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (!filter.includeCompleted) {
    clauses.push('completed_at IS NULL');
  }
  if (filter.projectId !== undefined) {
    if (filter.projectId === null) {
      clauses.push('project_id IS NULL');
    } else {
      clauses.push('project_id = ?');
      params.push(filter.projectId);
    }
  }
  if (filter.parentId !== undefined) {
    if (filter.parentId === null) {
      clauses.push('parent_id IS NULL');
    } else {
      clauses.push('parent_id = ?');
      params.push(filter.parentId);
    }
  }
  if (filter.search) {
    clauses.push('(title LIKE ? OR notes LIKE ?)');
    params.push(`%${filter.search}%`, `%${filter.search}%`);
  }
  const limit = filter.limit ?? 500;
  const rows = await db.all(
    `SELECT * FROM tasks WHERE ${clauses.join(' AND ')}
     ORDER BY completed_at IS NOT NULL, priority DESC, due_at IS NULL, due_at ASC, sort_order ASC, created_at ASC
     LIMIT ?`,
    [...params, limit],
  );
  return rows.map(toTask);
}

export async function createTask(
  db: SqlDriver,
  input: TaskInput,
  now = Date.now(),
): Promise<Task> {
  if (!input.title.trim()) {
    throw new Error('Task title is required');
  }
  if (input.recurrence) {
    parseRRule(input.recurrence);
  }
  const id = newId('task');
  const orderRow = await db.all('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM tasks');
  const sortOrder = asNumber(orderRow[0]?.next, 1);
  await db.run(
    `INSERT INTO tasks
       (id, title, notes, project_id, parent_id, priority, due_at, due_has_time,
        recurrence, completed_at, sort_order, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,
    [
      id,
      input.title.trim(),
      input.notes ?? null,
      input.projectId ?? null,
      input.parentId ?? null,
      input.priority ?? 1,
      input.dueAt ?? null,
      input.dueHasTime ?? false,
      input.recurrence ?? null,
      sortOrder,
      now,
      now,
    ],
  );
  const created = await getTask(db, id);
  if (!created) {
    throw new Error('Task insert failed');
  }
  return created;
}

export interface TaskPatch {
  title?: string;
  notes?: string | null;
  projectId?: ID | null;
  priority?: TaskPriority;
  dueAt?: number | null;
  dueHasTime?: boolean;
  recurrence?: string | null;
  sortOrder?: number;
}

export async function updateTask(
  db: SqlDriver,
  id: ID,
  patch: TaskPatch,
  now = Date.now(),
): Promise<Task> {
  const existing = await getTask(db, id);
  if (!existing) {
    throw new Error('Task not found');
  }
  if (patch.recurrence) {
    parseRRule(patch.recurrence);
  }
  const next = {...existing, ...patch};
  if (!next.title.trim()) {
    throw new Error('Task title is required');
  }
  await db.run(
    `UPDATE tasks SET title=?, notes=?, project_id=?, priority=?, due_at=?, due_has_time=?,
       recurrence=?, sort_order=?, updated_at=? WHERE id=?`,
    [
      next.title.trim(),
      next.notes,
      next.projectId,
      next.priority,
      next.dueAt,
      next.dueHasTime,
      next.recurrence,
      next.sortOrder,
      now,
      id,
    ],
  );
  const updated = await getTask(db, id);
  if (!updated) {
    throw new Error('Task update failed');
  }
  return updated;
}

export interface CompletionResult {
  task: Task;
  /** Set when a recurring task scheduled its next instance. */
  nextTask: Task | null;
}

export async function completeTask(
  db: SqlDriver,
  id: ID,
  now = Date.now(),
): Promise<CompletionResult> {
  const task = await getTask(db, id);
  if (!task) {
    throw new Error('Task not found');
  }
  return db.transaction(async tx => {
    await tx.run('UPDATE tasks SET completed_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
    await tx.run(
      `UPDATE reminders SET dismissed_at = ? WHERE kind = 'task' AND source_id = ? AND dismissed_at IS NULL`,
      [now, id],
    );
    let nextTask: Task | null = null;
    if (task.recurrence) {
      const rule = parseRRule(task.recurrence);
      const baseDue = task.dueAt;
      let nextDue: number | null = null;
      if (baseDue !== null) {
        const stepDays =
          rule?.freq === 'WEEKLY' ? 7 * rule.interval
          : rule?.freq === 'MONTHLY' ? 30 * rule.interval
          : rule?.freq === 'YEARLY' ? 365 * rule.interval
          : 1 * (rule?.interval ?? 1);
        nextDue = baseDue + stepDays * 86_400_000;
      }
      const created = await createTask(
        tx,
        {
          title: task.title,
          notes: task.notes,
          projectId: task.projectId,
          parentId: task.parentId,
          priority: task.priority,
          dueAt: nextDue,
          dueHasTime: task.dueHasTime,
          recurrence: task.recurrence,
        },
        now,
      );
      nextTask = created;
    }
    const updated = await getTask(tx, id);
    return {task: updated!, nextTask};
  });
}

export async function reopenTask(db: SqlDriver, id: ID, now = Date.now()): Promise<Task> {
  await db.run('UPDATE tasks SET completed_at = NULL, updated_at = ? WHERE id = ?', [now, id]);
  const task = await getTask(db, id);
  if (!task) {
    throw new Error('Task not found');
  }
  return task;
}

export async function deleteTask(db: SqlDriver, id: ID, now = Date.now()): Promise<ID[]> {
  const task = await getTask(db, id);
  if (!task) {
    throw new Error('Task not found');
  }
  const ids: ID[] = [id];
  await db.transaction(async tx => {
    await tx.run('UPDATE tasks SET deleted_at = ? WHERE id = ?', [now, id]);
    const children = await tx.all('SELECT id FROM tasks WHERE parent_id = ? AND deleted_at IS NULL', [id]);
    for (const row of children) {
      const childId = String(row.id);
      await tx.run('UPDATE tasks SET deleted_at = ? WHERE id = ?', [now, childId]);
      ids.push(childId);
    }
    await tx.run(
      `UPDATE reminders SET dismissed_at = ? WHERE kind = 'task' AND source_id = ? AND dismissed_at IS NULL`,
      [now, id],
    );
  });
  return ids;
}

export async function restoreTasks(db: SqlDriver, ids: readonly ID[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const placeholders = ids.map(() => '?').join(',');
  await db.run(`UPDATE tasks SET deleted_at = NULL WHERE id IN (${placeholders})`, [...ids]);
}

export interface TaskBuckets {
  overdue: Task[];
  today: Task[];
  upcoming: Task[];
  someday: Task[];
  completed: Task[];
}

/** Buckets open tasks by due date relative to the local day. */
export function bucketTasks(tasks: Task[], now: number, timeZone: string): TaskBuckets {
  const todayKey = localDateKey(now, timeZone);
  const buckets: TaskBuckets = {overdue: [], today: [], upcoming: [], someday: [], completed: []};
  for (const task of tasks) {
    if (task.completedAt !== null) {
      buckets.completed.push(task);
      continue;
    }
    if (task.dueAt === null) {
      buckets.someday.push(task);
      continue;
    }
    const key = localDateKey(task.dueAt, timeZone);
    if (key < todayKey) {
      buckets.overdue.push(task);
    } else if (key === todayKey) {
      buckets.today.push(task);
    } else {
      buckets.upcoming.push(task);
    }
  }
  return buckets;
}

export async function projectProgress(
  db: SqlDriver,
  projectId: ID,
): Promise<{total: number; done: number}> {
  const rows = await db.all(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done
     FROM tasks WHERE project_id = ? AND deleted_at IS NULL`,
    [projectId],
  );
  const row = rows[0] ?? {};
  return {total: asNumber(row.total), done: asNumber(row.done)};
}
