/**
 * Tasks: filters, project grouping, subtasks and recoverable deletion. The
 * checkbox path is the same repository call the assistant and widgets use.
 */
import React, {useMemo, useState} from 'react';
import {Alert, Pressable, ScrollView, View} from 'react-native';
import {Card, Chip, EmptyState, Field, GhostButton, Row, SectionHeader, Sheet, Txt} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {bucketTasks} from '../../repos/tasks';
import {dayLabel, relativeDay} from '../format';
import type {Task, TaskPriority} from '../../domain/types';

type Filter = 'inbox' | 'today' | 'upcoming' | 'overdue' | 'done' | 'project';

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  0: 'Low',
  1: 'Normal',
  2: 'High',
  3: 'Urgent',
};

export function TasksScreen({
  initialFilter,
  projectId: initialProjectId,
  onOpenTask,
  onNewTask,
  onOpenAssistant,
}: {
  initialFilter?: string;
  projectId?: string;
  onOpenTask: (id: string) => void;
  onNewTask: () => void;
  onOpenAssistant: () => void;
}): React.JSX.Element {
  const palette = useTheme();
  const snapshot = useStore(state => state.snapshot);
  const settings = useStore(state => state.settings);
  const toggleTask = useStore(state => state.toggleTask);
  const removeTask = useStore(state => state.removeTask);
  const addProject = useStore(state => state.addProject);
  const [filter, setFilter] = useState<Filter>(normalizeFilter(initialFilter));
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);
  const [projectSheet, setProjectSheet] = useState(false);
  const [projectName, setProjectName] = useState('');

  const tasks = snapshot?.tasks ?? [];
  const buckets = useMemo(
    () => bucketTasks(tasks.filter(task => !task.projectId || filter === 'project'), snapshot?.now ?? Date.now(), settings.calendarTimeZone),
    [tasks, snapshot?.now, settings.calendarTimeZone, filter],
  );

  const visible = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    const open = tasks.filter(task => !task.completedAt);
    switch (filter) {
      case 'today':
        return tasks.filter(
          task =>
            !task.completedAt &&
            task.dueAt &&
            relativeDay(task.dueAt, snapshot.now, settings.calendarTimeZone) === 'Today',
        );
      case 'upcoming':
        return tasks.filter(
          task =>
            !task.completedAt &&
            task.dueAt &&
            task.dueAt > snapshot.now &&
            relativeDay(task.dueAt, snapshot.now, settings.calendarTimeZone) !== 'Today',
        );
      case 'overdue':
        return open.filter(task => task.dueAt && task.dueAt < snapshot.now);
      case 'done':
        return tasks.filter(task => task.completedAt);
      case 'project':
        return tasks.filter(task => task.projectId === projectId);
      default:
        return open;
    }
  }, [filter, projectId, snapshot, settings.calendarTimeZone, tasks]);

  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of visible) {
      const key = task.completedAt
        ? 'Completed'
        : task.dueAt
          ? dayLabel(dayKey(task.dueAt, settings.calendarTimeZone), snapshot?.todayKey ?? '')
          : 'No due date';
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [visible, settings.calendarTimeZone, snapshot?.todayKey]);

  if (!snapshot) {
    return <View style={{padding: space.lg}}><Txt variant="small" color="muted">Loading tasks…</Txt></View>;
  }

  const confirmDelete = (task: Task): void => {
    Alert.alert('Delete task', `“${task.title}” will be removed. You can undo this.`, [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Delete', style: 'destructive', onPress: () => void removeTask(task.id)},
    ]);
  };

  return (
    <View style={{flex: 1}}>
      <ScrollView contentContainerStyle={{padding: space.lg, paddingBottom: 120}}>
        <Row align="space-between">
          <View>
            <Txt variant="h1">Tasks</Txt>
            <Txt variant="small" color="muted">
              {buckets.overdue.length} overdue · {buckets.today.length} today · {buckets.upcoming.length} upcoming
            </Txt>
          </View>
          <Pressable onPress={onOpenAssistant} accessibilityRole="button" accessibilityLabel="Add a task by voice">
            <Txt variant="small" color="accent" style={{fontWeight: '700'}}>
              ✦ VOICE
            </Txt>
          </Pressable>
        </Row>

        <Row gap={6} style={{marginTop: space.md, flexWrap: 'wrap'}}>
          {(['inbox', 'today', 'upcoming', 'overdue', 'done'] as Filter[]).map(option => (
            <Chip
              key={option}
              label={option.toUpperCase()}
              active={filter === option}
              onPress={() => {
                setFilter(option);
                setProjectId(undefined);
              }}
            />
          ))}
        </Row>

        <Row gap={6} style={{marginTop: space.sm, flexWrap: 'wrap'}}>
          {snapshot.projects.map(project => (
            <Chip
              key={project.id}
              label={project.name}
              active={filter === 'project' && projectId === project.id}
              onPress={() => {
                setFilter('project');
                setProjectId(project.id);
              }}
            />
          ))}
          <Pressable onPress={() => setProjectSheet(true)} accessibilityRole="button" accessibilityLabel="New project">
            <Txt variant="small" color="accent">
              + project
            </Txt>
          </Pressable>
        </Row>

        <SectionHeader title={filter === 'project' ? 'Project' : 'Tasks'} actionLabel="New task" onAction={onNewTask} />

        {visible.length === 0 ? (
          <EmptyState
            title="No tasks here"
            message="Add a task, or ask the assistant to create one for you."
            actionLabel="New task"
            onAction={onNewTask}
            glyph="✓"
          />
        ) : (
          grouped.map(([group, groupTasks]) => (
            <View key={group} style={{marginBottom: space.md}}>
              <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
                {group}
              </Txt>
              {groupTasks.map(task => (
                <Card
                  key={task.id}
                  style={{marginBottom: 6}}
                  onPress={() => onOpenTask(task.id)}
                  accessibilityLabel={`Edit ${task.title}`}>
                  <Row gap={10} align="flex-start">
                    <Pressable
                      onPress={() => void toggleTask(task)}
                      accessibilityRole="checkbox"
                      accessibilityState={{checked: Boolean(task.completedAt)}}
                      accessibilityLabel={`${task.completedAt ? 'Reopen' : 'Complete'} ${task.title}`}
                      hitSlop={8}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 7,
                        borderWidth: 1.5,
                        marginTop: 2,
                        borderColor: task.completedAt ? palette.sage : palette.line,
                        backgroundColor: task.completedAt ? palette.sage : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      {task.completedAt ? (
                        <Txt variant="micro" style={{color: '#FFFFFF', fontWeight: '900'}}>
                          ✓
                        </Txt>
                      ) : null}
                    </Pressable>
                    <View style={{flex: 1}}>
                      <Txt
                        variant="body"
                        numberOfLines={2}
                        style={{
                          textDecorationLine: task.completedAt ? 'line-through' : 'none',
                          color: task.completedAt ? palette.faint : palette.ink,
                        }}>
                        {task.title}
                      </Txt>
                      <Row gap={8} style={{marginTop: 2}}>
                        {task.dueAt ? (
                          <Txt variant="micro" color={task.dueAt < snapshot.now && !task.completedAt ? 'danger' : 'faint'}>
                            {relativeDay(task.dueAt, snapshot.now, settings.calendarTimeZone)}
                          </Txt>
                        ) : null}
                        {task.priority > 1 ? (
                          <Txt variant="micro" color={task.priority === 3 ? 'danger' : 'gold'}>
                            {PRIORITY_LABEL[task.priority]}
                          </Txt>
                        ) : null}
                        {snapshot.tasks.some(child => child.parentId === task.id) ? (
                          <Txt variant="micro" color="faint">
                            {snapshot.tasks.filter(child => child.parentId === task.id && !child.completedAt).length} subtasks
                          </Txt>
                        ) : null}
                      </Row>
                    </View>
                    <Pressable
                      onPress={() => confirmDelete(task)}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${task.title}`}
                      hitSlop={8}>
                      <Txt variant="small" color="faint">
                        ✕
                      </Txt>
                    </Pressable>
                  </Row>
                </Card>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <Sheet visible={projectSheet} onClose={() => setProjectSheet(false)} title="New project">
        <Field label="Project name" value={projectName} onChangeText={setProjectName} placeholder="Launch plan" autoFocus />
        <GhostButton
          label="Create project"
          onPress={() => {
            const name = projectName.trim();
            if (name === '') {
              return;
            }
            void addProject(name).then(() => {
              setProjectName('');
              setProjectSheet(false);
            });
          }}
        />
      </Sheet>
    </View>
  );
}

function normalizeFilter(value?: string): Filter {
  const allowed: Filter[] = ['inbox', 'today', 'upcoming', 'overdue', 'done', 'project'];
  return allowed.includes(value as Filter) ? (value as Filter) : 'inbox';
}

function dayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}
