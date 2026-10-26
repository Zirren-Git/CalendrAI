package com.dayloom.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.util.Calendar
import java.util.Locale

/**
 * A second connection to the same SQLite file the JS layer uses. Widgets and
 * reminder scheduling read from here so there is exactly one source of truth.
 * The database is app-private, so opening it read-write inside the same UID is
 * safe; WAL mode makes concurrent reads from the widget process fine.
 */
object DayloomDb {

  data class WidgetEvent(
      val title: String,
      val startAt: Long,
      val endAt: Long,
      val allDay: Boolean,
      val color: String
  )

  data class WidgetTask(val title: String, val dueAt: Long?, val priority: Int)

  data class WidgetFocus(val label: String, val startedAt: Long, val plannedMinutes: Int)

  data class PendingReminder(val id: String, val triggerAt: Long, val title: String, val body: String)

  fun databaseFile(context: Context): File = context.getDatabasePath("dayloom.db")

  fun open(context: Context): SQLiteDatabase =
      SQLiteDatabase.openDatabase(
          databaseFile(context).absolutePath, null, SQLiteDatabase.OPEN_READWRITE)

  private fun <T> query(context: Context, block: (SQLiteDatabase) -> T): T? {
    if (!databaseFile(context).exists()) {
      return null
    }
    return try {
      open(context).use(block)
    } catch (_: Throwable) {
      // A widget render must never crash the launcher if the database is busy
      // or the schema is mid-migration.
      null
    }
  }

  fun todayBounds(): Pair<Long, Long> {
    val calendar = Calendar.getInstance()
    calendar.set(Calendar.HOUR_OF_DAY, 0)
    calendar.set(Calendar.MINUTE, 0)
    calendar.set(Calendar.SECOND, 0)
    calendar.set(Calendar.MILLISECOND, 0)
    val start = calendar.timeInMillis
    calendar.add(Calendar.DAY_OF_YEAR, 1)
    return start to calendar.timeInMillis - 1
  }

  fun todayEvents(context: Context, limit: Int = 3): List<WidgetEvent> {
    val (start, end) = todayBounds()
    return query(context) { db ->
          db.rawQuery(
                  """
                  SELECT title, start_at, end_at, all_day, color
                  FROM occurrence_cache
                  WHERE end_at >= ? AND start_at <= ?
                  ORDER BY all_day DESC, start_at ASC
                  LIMIT ?
                  """
                      .trimIndent(),
                  arrayOf(start.toString(), end.toString(), limit.toString()))
              .use { cursor ->
                buildList {
                  while (cursor.moveToNext()) {
                    add(
                        WidgetEvent(
                            title = cursor.getString(0),
                            startAt = cursor.getLong(1),
                            endAt = cursor.getLong(2),
                            allDay = cursor.getInt(3) == 1,
                            color = cursor.getString(4)))
                  }
                }
              }
        }
        ?: emptyList()
  }

  fun openTasks(context: Context, limit: Int = 4): List<WidgetTask> =
      query(context) { db ->
            db.rawQuery(
                    """
                    SELECT title, due_at, priority FROM tasks
                    WHERE completed_at IS NULL AND deleted_at IS NULL
                    ORDER BY due_at IS NULL, due_at ASC, priority DESC
                    LIMIT ?
                    """
                        .trimIndent(),
                    arrayOf(limit.toString()))
                .use { cursor ->
                  buildList {
                    while (cursor.moveToNext()) {
                      add(
                          WidgetTask(
                              title = cursor.getString(0),
                              dueAt = if (cursor.isNull(1)) null else cursor.getLong(1),
                              priority = cursor.getInt(2)))
                    }
                  }
                }
          }
          ?: emptyList()

  fun activeFocus(context: Context): WidgetFocus? =
      query(context) { db ->
            db.rawQuery(
                    """
                    SELECT label, started_at, planned_minutes FROM focus_sessions
                    WHERE kind = 'focus' AND ended_at IS NULL
                    ORDER BY started_at DESC LIMIT 1
                    """
                        .trimIndent(),
                    null)
                .use { cursor ->
                  if (!cursor.moveToFirst()) null
                  else
                      WidgetFocus(
                          label = cursor.getString(0),
                          startedAt = cursor.getLong(1),
                          plannedMinutes = cursor.getInt(2))
                }
          }
          ?: null

  /** Days of the current month that have at least one event (for the calendar widget). */
  fun monthEventDays(context: Context, monthStart: Long, monthEnd: Long): Set<Int> {
    val calendar = Calendar.getInstance()
    return query(context) { db ->
          db.rawQuery(
                  """
                  SELECT DISTINCT start_at FROM occurrence_cache
                  WHERE end_at >= ? AND start_at <= ?
                  """
                      .trimIndent(),
                  arrayOf(monthStart.toString(), monthEnd.toString()))
              .use { cursor ->
                buildSet {
                  while (cursor.moveToNext()) {
                    calendar.timeInMillis = cursor.getLong(0)
                    add(calendar.get(Calendar.DAY_OF_MONTH))
                  }
                }
              }
        }
        ?: emptySet()
  }

  fun notificationsEnabled(context: Context): Boolean =
      query(context) { db ->
        db.rawQuery("SELECT value FROM settings WHERE key = ?", arrayOf("notificationsEnabled")).use { cursor ->
          if (!cursor.moveToFirst()) true else cursor.getString(0)?.toBooleanStrictOrNull() ?: true
        }
      } ?: true

  fun allReminderIds(context: Context): Set<String> =
      query(context) { db ->
        db.rawQuery("SELECT id FROM reminders", null).use { cursor ->
          buildSet {
            while (cursor.moveToNext()) add(cursor.getString(0))
          }
        }
      } ?: emptySet()

  fun pendingReminders(context: Context, after: Long): List<PendingReminder> =
      query(context) { db ->
            db.rawQuery(
                    """
                    SELECT id, trigger_at, title, COALESCE(body, '')
                    FROM reminders
                    WHERE dismissed_at IS NULL AND trigger_at > ?
                    ORDER BY trigger_at ASC
                    LIMIT 100
                    """
                        .trimIndent(),
                    arrayOf(after.toString()))
                .use { cursor ->
                  buildList {
                    while (cursor.moveToNext()) {
                      add(
                          PendingReminder(
                              id = cursor.getString(0),
                              triggerAt = cursor.getLong(1),
                              title = cursor.getString(2),
                              body = cursor.getString(3)))
                    }
                  }
                }
          }
          ?: emptyList()

  fun markReminderFired(context: Context, id: String) {
    query(context) { db ->
      val values = ContentValues().apply { put("fired_at", System.currentTimeMillis()) }
      db.update("reminders", values, "id = ?", arrayOf(id))
    }
  }

  fun todayLabel(): String =
      java.text.SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(java.util.Date())

  fun timeLabel(epochMs: Long): String =
      java.text.SimpleDateFormat("HH:mm", Locale.getDefault()).format(java.util.Date(epochMs))
}
