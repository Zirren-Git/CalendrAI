/** The renderer registry that turns the metadata catalog into live widgets. */
import type {ReactNode} from 'react';
import {CalendarHeatmapWidget, DayTimelineWidget, EventCountdownWidget, FreeTimeWidget, MonthGridWidget, NextEventWidget, TodayAgendaWidget, UpcomingEventsWidget, WeekAgendaWidget, WeekStripWidget} from './calendarWidgets';
import {CompletionRingWidget, FocusQueueWidget, KanbanBoardWidget, OverdueTasksWidget, PriorityMatrixWidget, ProjectProgressWidget, QuickAddTaskWidget, TaskInboxWidget, TasksTodayWidget, UpcomingTasksWidget} from './tasksWidgets';
import {DailyHabitChecklistWidget, EveningRoutineWidget, HabitScoreWidget, HabitStreakWidget, MorningRoutineWidget, WeeklyHabitGridWidget} from './habitWidgets';
import {BreakReminderWidget, FocusSessionsWidget, FocusTimerWidget, PomodoroTimerWidget, TimeBudgetWidget, TimeTrackingSummaryWidget} from './focusWidgets';
import {DailyJournalWidget, NotebookOverviewWidget, NotesSearchWidget, PinnedNoteWidget, QuickNoteWidget, RecentNotesWidget} from './noteWidgets';
import {CalendarLoadWidget, DailyIntentionWidget, DailyPlanWidget, FavoriteActionsWidget, GoalProgressWidget, MoodCheckinWidget, ProductivityScoreWidget, QuickCaptureWidget, ReminderInboxWidget, WeeklyReviewWidget} from './planningWidgets';
import {WIDGET_META} from './catalogData';
import type {WidgetContext, WidgetDefinition} from './types';

const RENDERERS: Record<string, (ctx: WidgetContext) => ReactNode> = {
  today_agenda: TodayAgendaWidget,
  day_timeline: DayTimelineWidget,
  week_strip: WeekStripWidget,
  week_agenda: WeekAgendaWidget,
  month_grid: MonthGridWidget,
  next_event: NextEventWidget,
  upcoming_events: UpcomingEventsWidget,
  event_countdown: EventCountdownWidget,
  free_time: FreeTimeWidget,
  calendar_heatmap: CalendarHeatmapWidget,
  task_inbox: TaskInboxWidget,
  tasks_today: TasksTodayWidget,
  overdue_tasks: OverdueTasksWidget,
  upcoming_tasks: UpcomingTasksWidget,
  priority_matrix: PriorityMatrixWidget,
  kanban_board: KanbanBoardWidget,
  project_progress: ProjectProgressWidget,
  completion_ring: CompletionRingWidget,
  quick_add_task: QuickAddTaskWidget,
  focus_queue: FocusQueueWidget,
  daily_habit_checklist: DailyHabitChecklistWidget,
  habit_streak: HabitStreakWidget,
  weekly_habit_grid: WeeklyHabitGridWidget,
  habit_score: HabitScoreWidget,
  morning_routine: MorningRoutineWidget,
  evening_routine: EveningRoutineWidget,
  pomodoro_timer: PomodoroTimerWidget,
  focus_timer: FocusTimerWidget,
  focus_sessions_today: FocusSessionsWidget,
  break_reminder: BreakReminderWidget,
  time_budget: TimeBudgetWidget,
  time_tracking_summary: TimeTrackingSummaryWidget,
  quick_note: QuickNoteWidget,
  pinned_note: PinnedNoteWidget,
  recent_notes: RecentNotesWidget,
  notes_search: NotesSearchWidget,
  daily_journal: DailyJournalWidget,
  notebook_overview: NotebookOverviewWidget,
  daily_plan: DailyPlanWidget,
  daily_intention: DailyIntentionWidget,
  goal_progress: GoalProgressWidget,
  weekly_review: WeeklyReviewWidget,
  productivity_score: ProductivityScoreWidget,
  calendar_load: CalendarLoadWidget,
  mood_checkin: MoodCheckinWidget,
  reminder_inbox: ReminderInboxWidget,
  quick_capture: QuickCaptureWidget,
  favorite_actions: FavoriteActionsWidget,
};

export const WIDGET_CATALOG: WidgetDefinition[] = WIDGET_META.map(meta => {
  const render = RENDERERS[meta.kind];
  if (!render) {
    throw new Error(`No renderer registered for widget ${meta.kind}`);
  }
  return {...meta, render};
});

const BY_KIND = new Map(WIDGET_CATALOG.map(definition => [definition.kind, definition]));

export function widgetDefinition(kind: string): WidgetDefinition | undefined {
  return BY_KIND.get(kind);
}

export const WIDGET_GROUPS = ['Calendar', 'Tasks', 'Habits', 'Focus', 'Notes', 'Planning'] as const;

export function widgetsByGroup(group: string): WidgetDefinition[] {
  return WIDGET_CATALOG.filter(definition => definition.group === group);
}

/** Guards a restored layout against kinds this build cannot render. */
export function isKnownWidget(kind: string): boolean {
  return BY_KIND.has(kind);
}

export const WIDGET_COUNT = WIDGET_CATALOG.length;
