/**
 * Event editor: create, update and delete (single occurrence or whole series).
 * Recurrence is stored as an RFC 5545 RRULE so export/import stays lossless.
 */
import React, {useEffect, useState} from 'react';
import {Alert, Pressable, ScrollView, View} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import {AppBar, Field, GhostButton, PrimaryButton, Row, Sheet, Txt} from '../components';
import {DateTimeField, Segmented} from '../forms';
import {EVENT_COLORS, space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {getEvent, addEventReminder, getEventReminders} from '../../repos/events';
import {buildRRule, describeRRule, parseRRule} from '../../domain/recurrence';
import {zonedParts} from '../../domain/time';
import type {RootStackParamList} from '../navigation';

type RecurrencePreset = 'none' | 'daily' | 'weekly' | 'monthly';

export function EventEditorScreen(): React.JSX.Element {
  const route = useRoute<RouteProp<RootStackParamList, 'EventEditor'>>();
  const navigation = useNavigation();
  const palette = useTheme();
  const db = useStore(state => state.db);
  const settings = useStore(state => state.settings);
  const snapshot = useStore(state => state.snapshot);
  const saveEvent = useStore(state => state.saveEvent);
  const removeEvent = useStore(state => state.removeEvent);
  const id = route.params?.id;

  const initialStart = route.params?.start ?? snapshot?.now ?? Date.now();
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [attendees, setAttendees] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialStart + settings.defaultEventMinutes * 60_000);
  const [color, setColor] = useState(EVENT_COLORS[0]!);
  const [recurrence, setRecurrence] = useState<RecurrencePreset>('none');
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(10);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    if (!id || !db) {
      return;
    }
    void getEvent(db, id).then(event => {
      if (!event) {
        setError('This event no longer exists.');
        setLoaded(true);
        return;
      }
      setTitle(event.title);
      setLocation(event.location ?? '');
      setNotes(event.notes ?? '');
      setAttendees(event.attendees.join(', '));
      setAllDay(event.allDay);
      setStart(event.start);
      setEnd(event.end);
      setColor(event.color || EVENT_COLORS[0]!);
      const rule = parseRRule(event.rrule);
      setRecurrence(rule ? (rule.freq.toLowerCase() as RecurrencePreset) : 'none');
      setLoaded(true);
    });
  }, [id, db]);

  const adjustEnd = (nextStart: number): void => {
    const duration = Math.max(15 * 60_000, end - start);
    setStart(nextStart);
    setEnd(nextStart + duration);
  };

  const save = async (): Promise<void> => {
    if (title.trim() === '') {
      setError('Give the event a title.');
      return;
    }
    if (end < start) {
      setError('The end time is before the start time.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const parts = zonedParts(start, settings.calendarTimeZone);
      const rrule =
        recurrence === 'none'
          ? null
          : buildRRule({
              freq: recurrence.toUpperCase() as 'DAILY' | 'WEEKLY' | 'MONTHLY',
              interval: 1,
              count: null,
              until: null,
              byDay: recurrence === 'weekly' ? [parts.weekday] : null,
              byMonthDay: null,
              byMonth: null,
              weekStart: settings.weekStartsOn,
            });
      const saved = await saveEvent(
        {
          title: title.trim(),
          start,
          end,
          allDay,
          timezone: settings.calendarTimeZone,
          location: location.trim() || null,
          notes: notes.trim() || null,
          color,
          attendees: attendees
            .split(',')
            .map(entry => entry.trim())
            .filter(entry => entry.length > 0),
          rrule,
        },
        id,
      );
      if (db && reminderMinutes !== null) {
        const existing = await getEventReminders(db, saved.id);
        const triggerAt = allDay ? start - reminderMinutes * 60_000 : start - reminderMinutes * 60_000;
        if (!existing.some(reminder => reminder.triggerAt === triggerAt)) {
          await addEventReminder(db, saved.id, triggerAt, saved.title, reminderMinutes);
        }
      }
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The event could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (scope: 'series' | 'occurrence'): void => {
    if (!id) {
      return;
    }
    setDeleteOpen(false);
    Alert.alert('Delete event', scope === 'series' ? 'Delete the whole series?' : 'Delete only this occurrence?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void removeEvent(id, scope, route.params?.occurrenceStart).then(() => navigation.goBack());
        },
      },
    ]);
  };

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <AppBar
        title={id ? 'Edit event' : 'New event'}
        onBack={() => navigation.goBack()}
        right={
          id ? (
            <Pressable
              onPress={() => setDeleteOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Delete event"
              hitSlop={8}>
              <Txt variant="small" color="danger">
                Delete
              </Txt>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={{padding: space.lg, paddingBottom: 48}} keyboardShouldPersistTaps="handled">
        {!loaded ? <Txt variant="small" color="muted">Loading…</Txt> : null}
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="Design review" autoFocus={!id} />
        <Row gap={8} style={{marginBottom: space.md, alignItems: 'center'}}>
          <GhostButton label={allDay ? 'All-day' : 'Timed'} onPress={() => setAllDay(value => !value)} />
          <Txt variant="micro" color="faint">
            {allDay ? 'One block for the whole day' : 'Set a start and end time'}
          </Txt>
        </Row>

        <DateTimeField
          label="Starts"
          value={start}
          onChange={adjustEnd}
          timeZone={settings.calendarTimeZone}
          clock24h={settings.clock24h}
          allDay={allDay}
        />
        <DateTimeField
          label="Ends"
          value={end}
          onChange={setEnd}
          timeZone={settings.calendarTimeZone}
          clock24h={settings.clock24h}
          allDay={allDay}
          error={end < start ? 'End must be after the start.' : null}
        />

        <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
          Repeats
        </Txt>
        <Segmented
          label="Recurrence"
          options={[
            {value: 'none', label: 'Never'},
            {value: 'daily', label: 'Daily'},
            {value: 'weekly', label: 'Weekly'},
            {value: 'monthly', label: 'Monthly'},
          ]}
          value={recurrence}
          onChange={setRecurrence}
        />
        <Txt variant="micro" color="faint" style={{marginTop: 6, marginBottom: space.md}}>
          {describeRRule(
            recurrence === 'none' ? null : parseRRule(buildRRule({
              freq: recurrence.toUpperCase() as 'DAILY' | 'WEEKLY' | 'MONTHLY',
              interval: 1,
              count: null,
              until: null,
              byDay: recurrence === 'weekly' ? [zonedParts(start, settings.calendarTimeZone).weekday] : null,
              byMonthDay: null,
              byMonth: null,
              weekStart: settings.weekStartsOn,
            })),
          ) ?? 'Does not repeat'}
        </Txt>

        <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
          Colour
        </Txt>
        <Row gap={8} style={{marginBottom: space.md}}>
          {EVENT_COLORS.map(option => (
            <Pressable
              key={option}
              onPress={() => setColor(option)}
              accessibilityRole="radio"
              accessibilityState={{selected: color === option}}
              accessibilityLabel={`Event colour ${option}`}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: option,
                borderWidth: color === option ? 3 : 1,
                borderColor: color === option ? palette.ink : palette.line,
              }}
            />
          ))}
        </Row>

        <Field label="Location" value={location} onChangeText={setLocation} placeholder="Room 3 / link" />
        <Field label="Attendees (local text)" value={attendees} onChangeText={setAttendees} placeholder="Ana, Ben" />
        <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Agenda, links, context" multiline />

        <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
          Reminder
        </Txt>
        <Segmented
          label="Reminder timing"
          value={reminderMinutes === null ? 'none' : String(reminderMinutes)}
          options={[
            {value: 'none', label: 'None'},
            {value: '0', label: 'At start'},
            {value: '10', label: '10 min'},
            {value: '30', label: '30 min'},
            {value: '60', label: '1 hour'},
          ]}
          onChange={value => setReminderMinutes(value === 'none' ? null : Number(value))}
        />

        {error ? (
          <Txt variant="small" color="danger" style={{marginTop: space.md}}>
            {error}
          </Txt>
        ) : null}

        <View style={{marginTop: space.lg}}>
          <PrimaryButton label={busy ? 'Saving…' : id ? 'Save changes' : 'Create event'} onPress={() => void save()} loading={busy} />
        </View>
      </ScrollView>

      <Sheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete event">
        <Txt variant="small" color="muted" style={{marginBottom: space.md}}>
          Recurring events can be removed for one occurrence or for the whole series. Deleted events can be undone
          from the home screen.
        </Txt>
        <View style={{gap: space.sm}}>
          <GhostButton label="This occurrence only" tone="danger" onPress={() => confirmDelete('occurrence')} />
          <GhostButton label="The whole series" tone="danger" onPress={() => confirmDelete('series')} />
        </View>
      </Sheet>
    </View>
  );
}
