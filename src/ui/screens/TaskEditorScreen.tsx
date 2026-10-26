/** Task editor: due dates, priority, project, recurrence and subtasks. */
import React, {useEffect, useMemo, useState} from 'react';
import {Alert, Pressable, ScrollView, View} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import {AppBar, Card, Chip, Field, GhostButton, PrimaryButton, Row, Txt} from '../components';
import {DateTimeField, Segmented} from '../forms';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {buildRRule, describeRRule, parseRRule} from '../../domain/recurrence';
import {zonedParts} from '../../domain/time';
import type {TaskPriority} from '../../domain/types';
import type {RootStackParamList} from '../navigation';

type RecurrencePreset = 'none' | 'daily' | 'weekly' | 'monthly';

export function TaskEditorScreen(): React.JSX.Element {
  const route = useRoute<RouteProp<RootStackParamList, 'TaskEditor'>>();
  const navigation = useNavigation();
  const palette = useTheme();
  const snapshot = useStore(state => state.snapshot);
  const settings = useStore(state => state.settings);
  const saveTask = useStore(state => state.saveTask);
  const removeTask = useStore(state => state.removeTask);
  const existing = snapshot?.tasks.find(task => task.id === route.params?.id);
  const id = route.params?.id;

  const [title, setTitle] = useState(existing?.title ?? route.params?.title ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [priority, setPriority] = useState<TaskPriority>(existing?.priority ?? 1);
  const [projectId, setProjectId] = useState<string | null>(existing?.projectId ?? route.params?.projectId ?? null);
  const [hasDue, setHasDue] = useState(Boolean(existing?.dueAt));
  const [dueAt, setDueAt] = useState(existing?.dueAt ?? snapshot?.now ?? Date.now());
  const [recurrence, setRecurrence] = useState<RecurrencePreset>(
    existing?.recurrence ? (parseRRule(existing.recurrence)?.freq.toLowerCase() as RecurrencePreset) : 'none',
  );
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (existing) {
      setTitle(existing.title);
      setNotes(existing.notes ?? '');
    }
  }, [existing]);

  const subtasks = useMemo(
    () => (snapshot?.tasks ?? []).filter(task => task.parentId === id),
    [snapshot?.tasks, id],
  );

  const save = async (): Promise<void> => {
    if (title.trim() === '') {
      setError('Give the task a title.');
      return;
    }
    setBusy(true);
    try {
      const rrule =
        recurrence === 'none'
          ? null
          : buildRRule({
              freq: recurrence.toUpperCase() as 'DAILY' | 'WEEKLY' | 'MONTHLY',
              interval: 1,
              count: null,
              until: null,
              byDay: recurrence === 'weekly' ? [zonedParts(dueAt, settings.calendarTimeZone).weekday] : null,
              byMonthDay: null,
              byMonth: null,
              weekStart: settings.weekStartsOn,
            });
      await saveTask(
        {
          title: title.trim(),
          notes: notes.trim() || null,
          priority,
          projectId,
          dueAt: hasDue ? dueAt : null,
          dueHasTime: false,
          recurrence: rrule,
        },
        id,
      );
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The task could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const addSubtask = async (): Promise<void> => {
    const trimmed = subtaskTitle.trim();
    if (trimmed === '' || !id) {
      return;
    }
    await saveTask({title: trimmed, parentId: id});
    setSubtaskTitle('');
  };

  const confirmDelete = (): void => {
    if (!id) {
      return;
    }
    Alert.alert('Delete task', 'The task and its subtasks will be removed. You can undo this.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void removeTask(id).then(() => navigation.goBack()),
      },
    ]);
  };

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <AppBar
        title={id ? 'Edit task' : 'New task'}
        onBack={() => navigation.goBack()}
        right={
          id ? (
            <Pressable onPress={confirmDelete} accessibilityRole="button" accessibilityLabel="Delete task" hitSlop={8}>
              <Txt variant="small" color="danger">
                Delete
              </Txt>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={{padding: space.lg, paddingBottom: 48}} keyboardShouldPersistTaps="handled">
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="Draft the launch note" autoFocus={!id} />
        <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Details, links, next step" multiline />

        <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
          Priority
        </Txt>
        <Segmented
          label="Priority"
          value={String(priority)}
          options={[
            {value: '0', label: 'Low'},
            {value: '1', label: 'Normal'},
            {value: '2', label: 'High'},
            {value: '3', label: 'Urgent'},
          ]}
          onChange={value => setPriority(Number(value) as TaskPriority)}
        />

        <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginTop: space.md, marginBottom: 6}}>
          Project
        </Txt>
        <Row gap={6} style={{flexWrap: 'wrap', marginBottom: space.md}}>
          <Chip label="None" active={projectId === null} onPress={() => setProjectId(null)} />
          {(snapshot?.projects ?? []).map(project => (
            <Chip
              key={project.id}
              label={project.name}
              active={projectId === project.id}
              onPress={() => setProjectId(project.id)}
            />
          ))}
        </Row>

        <Row align="space-between" style={{marginBottom: space.sm}}>
          <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
            Due date
          </Txt>
          <GhostButton label={hasDue ? 'Remove due date' : 'Add due date'} onPress={() => setHasDue(value => !value)} />
        </Row>
        {hasDue ? (
          <DateTimeField
            label="Due"
            value={dueAt}
            onChange={next => {
              setDueAt(next);
              setHasDue(true);
            }}
            timeZone={settings.calendarTimeZone}
            clock24h={settings.clock24h}
            allDay
          />
        ) : null}

        <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
          Repeats
        </Txt>
        <Segmented
          label="Recurrence"
          value={recurrence}
          options={[
            {value: 'none', label: 'Never'},
            {value: 'daily', label: 'Daily'},
            {value: 'weekly', label: 'Weekly'},
            {value: 'monthly', label: 'Monthly'},
          ]}
          onChange={setRecurrence}
        />
        <Txt variant="micro" color="faint" style={{marginTop: 6}}>
          {recurrence === 'none'
            ? 'One-off task'
            : describeRRule(
                parseRRule(
                  buildRRule({
                    freq: recurrence.toUpperCase() as 'DAILY' | 'WEEKLY' | 'MONTHLY',
                    interval: 1,
                    count: null,
                    until: null,
                    byDay: recurrence === 'weekly' ? [zonedParts(dueAt, settings.calendarTimeZone).weekday] : null,
                    byMonthDay: null,
                    byMonth: null,
                    weekStart: settings.weekStartsOn,
                  }),
                ),
              )}
        </Txt>

        {id ? (
          <View style={{marginTop: space.lg}}>
            <Txt variant="h3" style={{marginBottom: 6}}>
              Subtasks
            </Txt>
            {subtasks.length === 0 ? (
              <Txt variant="small" color="faint">
                No subtasks yet.
              </Txt>
            ) : (
              subtasks.map(subtask => (
                <Card key={subtask.id} style={{marginBottom: 6}}>
                  <Txt variant="small" style={{textDecorationLine: subtask.completedAt ? 'line-through' : 'none'}}>
                    {subtask.completedAt ? '✓ ' : '○ '}
                    {subtask.title}
                  </Txt>
                </Card>
              ))
            )}
            <Row gap={8} style={{marginTop: 6}}>
              <View style={{flex: 1}}>
                <Field placeholder="Add a subtask" value={subtaskTitle} onChangeText={setSubtaskTitle} />
              </View>
              <GhostButton label="Add" onPress={() => void addSubtask()} />
            </Row>
          </View>
        ) : null}

        {error ? (
          <Txt variant="small" color="danger" style={{marginTop: space.sm}}>
            {error}
          </Txt>
        ) : null}
        <View style={{marginTop: space.lg}}>
          <PrimaryButton label={busy ? 'Saving…' : id ? 'Save changes' : 'Create task'} onPress={() => void save()} loading={busy} />
        </View>
      </ScrollView>
    </View>
  );
}
