/** Task widgets (11–20). Checkboxes write through the same repositories as the task screen. */
import React, {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, TextInput, View} from 'react-native';
import {Txt} from '../components';
import {radius, space, useTheme} from '../theme';
import {MiniList, Ring, WidgetEmpty} from './primitives';
import {
  completedToday,
  openTasks,
  overdueTasks,
  projectCompletion,
  taskDayKey,
  tasksToday,
  upcomingTasks,
  taskProjectName,
} from './data';
import {dayLabel, relativeDay} from '../format';
import {useStore} from '../../state/store';
import type {Task} from '../../domain/types';
import type {WidgetContext} from './types';

export function TaskCheckbox({task, onPress}: {task: Task; onPress: () => void}): React.JSX.Element {
  const palette = useTheme();
  const done = Boolean(task.completedAt);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{checked: done}}
      accessibilityLabel={`${done ? 'Reopen' : 'Complete'} ${task.title}`}
      hitSlop={8}
      style={[
        styles.checkbox,
        {borderColor: done ? palette.sage : palette.line, backgroundColor: done ? palette.sage : 'transparent'},
      ]}>
      {done ? (
        <Txt variant="micro" style={{color: '#FFFFFF', fontWeight: '900'}}>
          ✓
        </Txt>
      ) : null}
    </Pressable>
  );
}

function taskRow(
  task: Task,
  ctx: WidgetContext,
  toggle: (task: Task) => void,
): {
  key: string;
  title: string;
  meta?: string;
  done?: boolean;
  tone?: string;
  onPress: () => void;
  accessibilityLabel: string;
} {
  const project = taskProjectName(ctx.snapshot, task);
  return {
    key: task.id,
    title: task.title,
    meta: project ?? (task.dueAt ? relativeDay(task.dueAt, ctx.snapshot.now, ctx.settings.calendarTimeZone) : undefined),
    done: Boolean(task.completedAt),
    tone: task.completedAt ? ctx.palette.sage : ctx.palette.accent,
    onPress: () => toggle(task),
    accessibilityLabel: `${task.title}. Tap to ${task.completedAt ? 'reopen' : 'complete'}.`,
  };
}

export function TaskInboxWidget(ctx: WidgetContext): React.JSX.Element {
  const toggle = useStore(state => state.toggleTask);
  const items = openTasks(ctx.snapshot).slice(0, 6);
  if (items.length === 0) {
    return <WidgetEmpty text="Inbox is clear." actionLabel="Open tasks" onAction={() => ctx.navigate('tasks')} />;
  }
  return <MiniList items={items.map(task => taskRow(task, ctx, toggle))} />;
}

export function TasksTodayWidget(ctx: WidgetContext): React.JSX.Element {
  const toggle = useStore(state => state.toggleTask);
  const items = tasksToday(ctx.snapshot, ctx.settings);
  const done = completedToday(ctx.snapshot, ctx.settings);
  if (items.length === 0 && done.length === 0) {
    return <WidgetEmpty text="No tasks due today." actionLabel="Add one" onAction={() => ctx.navigate('task', {})} />;
  }
  return (
    <MiniList
      items={[
        ...items.map(task => taskRow(task, ctx, toggle)),
        ...done.map(task => taskRow(task, ctx, toggle)),
      ].slice(0, 7)}
    />
  );
}

export function OverdueTasksWidget(ctx: WidgetContext): React.JSX.Element {
  const toggle = useStore(state => state.toggleTask);
  const items = overdueTasks(ctx.snapshot, ctx.settings);
  if (items.length === 0) {
    return <WidgetEmpty text="Nothing overdue. Good." />;
  }
  return (
    <MiniList
      items={items.slice(0, 6).map(task =>
        taskRow(task, ctx, toggle),
      )}
    />
  );
}

export function UpcomingTasksWidget(ctx: WidgetContext): React.JSX.Element {
  const toggle = useStore(state => state.toggleTask);
  const items = upcomingTasks(ctx.snapshot, ctx.settings, 14);
  if (items.length === 0) {
    return <WidgetEmpty text="Nothing due in the next two weeks." />;
  }
  return (
    <MiniList
      items={items.slice(0, 6).map(task => {
        const key = taskDayKey(task, ctx.settings);
        return {
          ...taskRow(task, ctx, toggle),
          meta: key ? dayLabel(key, ctx.snapshot.todayKey) : undefined,
        };
      })}
    />
  );
}

export function PriorityMatrixWidget(ctx: WidgetContext): React.JSX.Element {
  const palette = useTheme();
  const open = openTasks(ctx.snapshot);
  const quadrants: {label: string; hint: string; tasks: Task[]; color: string}[] = [
    {
      label: 'Do now',
      hint: 'high priority · due soon',
      color: palette.danger,
      tasks: open.filter(task => task.priority >= 2 && isDueSoon(task, ctx)),
    },
    {
      label: 'Schedule',
      hint: 'high priority · later',
      color: palette.gold,
      tasks: open.filter(task => task.priority >= 2 && !isDueSoon(task, ctx)),
    },
    {
      label: 'Quick wins',
      hint: 'low priority · due soon',
      color: palette.sage,
      tasks: open.filter(task => task.priority < 2 && isDueSoon(task, ctx)),
    },
    {
      label: 'Later',
      hint: 'low priority · later',
      color: palette.sky,
      tasks: open.filter(task => task.priority < 2 && !isDueSoon(task, ctx)),
    },
  ];
  return (
    <View style={{gap: 6}}>
      {quadrants.map(quadrant => (
        <View key={quadrant.label} style={styles.quadrant}>
          <View style={[styles.quadrantBar, {backgroundColor: quadrant.color}]} />
          <View style={{flex: 1}}>
            <Txt variant="small" style={{fontWeight: '700'}}>
              {quadrant.label} · {quadrant.tasks.length}
            </Txt>
            <Txt variant="micro" color="faint" numberOfLines={1}>
              {quadrant.tasks[0]?.title ?? quadrant.hint}
            </Txt>
          </View>
        </View>
      ))}
    </View>
  );
}

function isDueSoon(task: Task, ctx: WidgetContext): boolean {
  if (!task.dueAt) {
    return false;
  }
  return task.dueAt <= ctx.snapshot.now + 2 * 86_400_000;
}

export function KanbanBoardWidget(ctx: WidgetContext): React.JSX.Element {
  const palette = useTheme();
  const toggle = useStore(state => state.toggleTask);
  const columns = [
    {key: 'todo', label: 'To do', tasks: openTasks(ctx.snapshot).filter(task => !task.dueAt)},
    {
      key: 'today',
      label: 'Due today',
      tasks: tasksToday(ctx.snapshot, ctx.settings),
    },
    {
      key: 'done',
      label: 'Done today',
      tasks: completedToday(ctx.snapshot, ctx.settings),
    },
  ];
  if (openTasks(ctx.snapshot).length === 0 && columns[2]!.tasks.length === 0) {
    return <WidgetEmpty text="No tasks on the board." />;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: space.sm}}>
      {columns.map(column => (
        <View key={column.key} style={[styles.column, {backgroundColor: palette.surfaceAlt, borderColor: palette.line}]}>
          <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
            {column.label} · {column.tasks.length}
          </Txt>
          {column.tasks.slice(0, 3).map(task => (
            <Pressable
              key={task.id}
              onPress={() => toggle(task)}
              accessibilityRole="button"
              accessibilityLabel={`${task.title}, move to ${task.completedAt ? 'to do' : 'done'}`}
              style={[styles.kanbanCard, {backgroundColor: palette.surface, borderColor: palette.line}]}>
              <Txt variant="small" numberOfLines={2}>
                {task.title}
              </Txt>
            </Pressable>
          ))}
          {column.tasks.length === 0 ? (
            <Txt variant="micro" color="faint">
              empty
            </Txt>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

export function ProjectProgressWidget(ctx: WidgetContext): React.JSX.Element {
  const palette = useTheme();
  const projects = ctx.snapshot.projects.filter(project => !project.archived);
  if (projects.length === 0) {
    return <WidgetEmpty text="No projects yet." actionLabel="Open tasks" onAction={() => ctx.navigate('tasks')} />;
  }
  return (
    <View style={{gap: space.sm}}>
      {projects.slice(0, 4).map(project => {
        const stats = projectCompletion(ctx.snapshot, project.id);
        const ratio = stats.total === 0 ? 0 : stats.done / stats.total;
        return (
          <Pressable
            key={project.id}
            onPress={() => ctx.navigate('tasks', {filter: 'project', projectId: project.id})}
            accessibilityRole="button"
            accessibilityLabel={`${project.name}: ${stats.done} of ${stats.total} tasks done`}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3}}>
              <Txt variant="small">{project.name}</Txt>
              <Txt variant="micro" color="muted">
                {stats.done}/{stats.total}
              </Txt>
            </View>
            <View style={{height: 6, borderRadius: 3, backgroundColor: palette.surfaceAlt, overflow: 'hidden'}}>
              <View style={{width: `${ratio * 100}%`, height: 6, backgroundColor: project.color || palette.accent}} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CompletionRingWidget(ctx: WidgetContext): React.JSX.Element {
  const toggle = useStore(state => state.toggleTask);
  const done = completedToday(ctx.snapshot, ctx.settings);
  const remaining = tasksToday(ctx.snapshot, ctx.settings);
  const total = done.length + remaining.length;
  const ratio = total === 0 ? 0 : done.length / total;
  return (
    <View style={{gap: space.sm}}>
      <Ring
        progress={ratio}
        label={`${Math.round(ratio * 100)}%`}
        caption={`${done.length} of ${total} ${total === 1 ? 'task' : 'tasks'} done today`}
        color={ctx.palette.sage}
      />
      {remaining[0] ? (
        <Pressable
          onPress={() => toggle(remaining[0]!)}
          accessibilityRole="button"
          accessibilityLabel={`Complete ${remaining[0]!.title}`}
          style={{flexDirection: 'row', gap: 6, alignItems: 'center'}}>
          <TaskCheckbox task={remaining[0]!} onPress={() => toggle(remaining[0]!)} />
          <Txt variant="small" numberOfLines={1} style={{flex: 1}}>
            {remaining[0]!.title}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

export function QuickAddTaskWidget(ctx: WidgetContext): React.JSX.Element {
  const palette = useTheme();
  const saveTask = useStore(state => state.saveTask);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const submit = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed === '') {
      return;
    }
    try {
      await saveTask({title: trimmed, dueAt: ctx.snapshot.now, dueHasTime: false});
      setTitle('');
      setStatus('Added to today');
    } catch {
      setStatus('Could not add that task');
    }
  };
  return (
    <View style={{gap: 6}}>
      <TextInput
        value={title}
        onChangeText={value => {
          setTitle(value);
          setStatus(null);
        }}
        onSubmitEditing={submit}
        placeholder="Add a task…"
        placeholderTextColor={palette.faint}
        accessibilityLabel="New task title"
        returnKeyType="done"
        style={[styles.quickInput, {backgroundColor: palette.surfaceAlt, borderColor: palette.line, color: palette.ink}]}
      />
      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
        <Txt variant="micro" color={status ? 'sage' : 'faint'}>
          {status ?? 'Due today'}
        </Txt>
        <Pressable
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel="Add task"
          style={[styles.quickButton, {backgroundColor: palette.ink}]}>
          <Txt variant="micro" style={{color: palette.bg, fontWeight: '800'}}>
            ADD
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

export function FocusQueueWidget(ctx: WidgetContext): React.JSX.Element {
  const toggle = useStore(state => state.toggleTask);
  const queue = openTasks(ctx.snapshot)
    .slice()
    .sort((a, b) => b.priority - a.priority || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
    .slice(0, 5);
  if (queue.length === 0) {
    return <WidgetEmpty text="Queue is empty." />;
  }
  return (
    <View style={{gap: 4}}>
      {queue.map((task, index) => (
        <View key={task.id} style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
          <Txt variant="micro" color="faint" style={{width: 12}}>
            {index + 1}
          </Txt>
          <TaskCheckbox task={task} onPress={() => toggle(task)} />
          <Pressable
            onPress={() => ctx.navigate('focus', {taskId: task.id, label: task.title})}
            accessibilityRole="button"
            accessibilityLabel={`Start focus for ${task.title}`}
            style={{flex: 1}}>
            <Txt variant="small" numberOfLines={1}>
              {task.title}
            </Txt>
          </Pressable>
          {task.priority >= 2 ? (
            <Txt variant="micro" color="danger">
              {task.priority === 3 ? '!!' : '!'}
            </Txt>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  checkbox: {width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center'},
  quadrant: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2},
  quadrantBar: {width: 3, height: 26, borderRadius: 2},
  column: {width: 130, borderRadius: radius.md, borderWidth: 1, padding: 8, gap: 6, minHeight: 90},
  kanbanCard: {borderRadius: radius.sm, borderWidth: 1, padding: 6},
  quickInput: {borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14},
  quickButton: {paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill},
});
