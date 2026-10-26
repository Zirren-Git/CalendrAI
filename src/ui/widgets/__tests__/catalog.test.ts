import {WIDGET_META} from '../catalogData';
import {DEFAULT_WIDGET_KINDS} from '../../../repos/system';

const REQUIRED_KINDS = [
  'today_agenda',
  'day_timeline',
  'week_strip',
  'week_agenda',
  'month_grid',
  'next_event',
  'upcoming_events',
  'event_countdown',
  'free_time',
  'calendar_heatmap',
  'task_inbox',
  'tasks_today',
  'overdue_tasks',
  'upcoming_tasks',
  'priority_matrix',
  'kanban_board',
  'project_progress',
  'completion_ring',
  'quick_add_task',
  'focus_queue',
  'daily_habit_checklist',
  'habit_streak',
  'weekly_habit_grid',
  'habit_score',
  'morning_routine',
  'evening_routine',
  'pomodoro_timer',
  'focus_timer',
  'focus_sessions_today',
  'break_reminder',
  'time_budget',
  'time_tracking_summary',
  'quick_note',
  'pinned_note',
  'recent_notes',
  'notes_search',
  'daily_journal',
  'notebook_overview',
  'daily_plan',
  'daily_intention',
  'goal_progress',
  'weekly_review',
  'productivity_score',
  'calendar_load',
  'mood_checkin',
  'reminder_inbox',
  'quick_capture',
  'favorite_actions',
] as const;

describe('widget catalog', () => {
  it('contains exactly the 48 required widget kinds', () => {
    expect(WIDGET_META).toHaveLength(48);
    expect(new Set(WIDGET_META.map(entry => entry.kind)).size).toBe(48);
    expect(new Set(WIDGET_META.map(entry => entry.kind))).toEqual(new Set(REQUIRED_KINDS));
  });

  it('gives every widget a unique title and a description', () => {
    const titles = WIDGET_META.map(entry => entry.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const entry of WIDGET_META) {
      expect(entry.description.length).toBeGreaterThan(5);
      expect([1, 2]).toContain(entry.defaultSpan);
    }
  });

  it('only uses known groups', () => {
    const groups = new Set(['Calendar', 'Tasks', 'Habits', 'Focus', 'Notes', 'Planning']);
    for (const entry of WIDGET_META) {
      expect(groups.has(entry.group)).toBe(true);
    }
  });

  it('defines valid, non-empty configuration fields', () => {
    for (const entry of WIDGET_META) {
      const keys = new Set<string>();
      for (const field of entry.configFields) {
        expect(field.key.length).toBeGreaterThan(0);
        expect(keys.has(field.key)).toBe(false);
        keys.add(field.key);
        if (field.type === 'select') {
          expect(field.options.length).toBeGreaterThan(1);
          expect(new Set(field.options.map(option => option.value)).size).toBe(field.options.length);
        }
        if (field.type === 'number') {
          expect(field.min).toBeLessThan(field.max);
        }
      }
    }
  });

  it('keeps the default dashboard layout renderable', () => {
    const kinds = new Set(WIDGET_META.map(entry => entry.kind));
    for (const placement of DEFAULT_WIDGET_KINDS) {
      expect(kinds.has(placement.kind)).toBe(true);
      expect([1, 2]).toContain(placement.span);
    }
  });
});
