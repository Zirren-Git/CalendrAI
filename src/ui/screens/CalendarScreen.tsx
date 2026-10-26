/**
 * Calendar: day, week, month and agenda views over the local events table.
 * Occurrences are expanded by the repository (recurrence + exceptions) so this
 * screen never re-implements the rule engine.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, View} from 'react-native';
import {useTheme} from '../theme';
import {space} from '../theme';
import {Card, Chip, EmptyState, Row, SectionHeader, Txt} from '../components';
import {eventTimeLabel, minutesLabel, relativeDay, WEEKDAY_SHORT} from '../format';
import {
  addDaysToDateKey,
  localDateKey,
  parseDateKey,
  startOfLocalDay,
  wallClockToUtc,
} from '../../domain/time';
import {listOccurrences} from '../../repos/events';
import {useStore} from '../../state/store';
import {findConflicts, findFreeSlots} from '../../domain/events';
import type {Occurrence} from '../../domain/types';
import {monthGridKeys} from '../widgets/data';

type ViewMode = 'day' | 'week' | 'month' | 'agenda';

export function CalendarScreen({
  focusDate,
  onOpenEvent,
  onNewEvent,
  onOpenAssistant,
}: {
  focusDate?: string;
  onOpenEvent: (id: string) => void;
  onNewEvent: (start?: number, end?: number) => void;
  onOpenAssistant: () => void;
}): React.JSX.Element {
  const palette = useTheme();
  const settings = useStore(state => state.settings);
  const snapshot = useStore(state => state.snapshot);
  const db = useStore(state => state.db);
  const todayKey = snapshot?.todayKey ?? localDateKey(Date.now(), settings.calendarTimeZone);
  const [cursor, setCursor] = useState(focusDate ?? todayKey);
  const [view, setView] = useState<ViewMode>('day');
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);

  useEffect(() => {
    if (focusDate) {
      setCursor(focusDate);
    }
  }, [focusDate]);

  const range = useMemo(() => {
    const parts = parseDateKey(cursor);
    const monthStart = wallClockToUtc({year: parts.year, month: parts.month, day: 1, hour: 0, minute: 0}, settings.calendarTimeZone);
    const span = view === 'month' ? 70 : view === 'week' ? 14 : 3;
    return {
      start: startOfLocalDay(monthStart, settings.calendarTimeZone),
      end: monthStart + span * 86_400_000,
    };
  }, [cursor, settings.calendarTimeZone, view]);

  useEffect(() => {
    if (!db) {
      return;
    }
    let alive = true;
    listOccurrences(db, range.start, range.end)
      .then(rows => {
        if (alive) {
          setOccurrences(rows);
        }
      })
      .catch(() => {
        if (alive) {
          setOccurrences([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [db, range.start, range.end]);

  const onDate = (key: string): void => setCursor(key);
  const shift = (days: number): void => setCursor(addDaysToDateKey(cursor, days));
  const parts = parseDateKey(cursor);
  const monthLabel = new Date(Date.UTC(parts.year, parts.month - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const dayOccurrences = occurrences.filter(
    occurrence => localDateKey(occurrence.start, settings.calendarTimeZone) === cursor,
  );
  const conflicts = findConflicts(dayOccurrences);
  const free = findFreeSlots(dayOccurrences, wallClockToUtc({...parts, hour: 12, minute: 0}, settings.calendarTimeZone), settings.calendarTimeZone, {
    workdayStart: settings.workdayStart,
    workdayEnd: settings.workdayEnd,
    minMinutes: 30,
  });

  return (
    <ScrollView style={{flex: 1}} contentContainerStyle={{padding: space.lg, paddingBottom: 120}}>
      <Row align="space-between">
        <View>
          <Txt variant="h1">{monthLabel}</Txt>
          <Txt variant="small" color="muted">
            {relativeDay(
              wallClockToUtc({...parseDateKey(cursor), hour: 12, minute: 0}, settings.calendarTimeZone),
              Date.now(),
              settings.calendarTimeZone,
            )}
          </Txt>
        </View>
        <Row gap={4}>
          <NavButton glyph="‹" label="Previous" onPress={() => shift(view === 'month' ? -28 : -1)} />
          <NavButton glyph="•" label="Jump to today" onPress={() => setCursor(todayKey)} />
          <NavButton glyph="›" label="Next" onPress={() => shift(view === 'month' ? 28 : 1)} />
        </Row>
      </Row>

      <Row gap={6} style={{marginVertical: space.md, flexWrap: 'wrap'}}>
        {(['day', 'week', 'month', 'agenda'] as ViewMode[]).map(mode => (
          <Chip key={mode} label={mode.toUpperCase()} active={view === mode} onPress={() => setView(mode)} />
        ))}
        <View style={{flex: 1}} />
        <Pressable
          onPress={onOpenAssistant}
          accessibilityRole="button"
          accessibilityLabel="Add an event with the assistant">
          <Txt variant="micro" color="accent" style={{fontWeight: '800'}}>
            ✦ VOICE
          </Txt>
        </Pressable>
      </Row>

      {view === 'month' ? (
        <MonthPicker
          cursor={cursor}
          todayKey={todayKey}
          weekStartsOn={settings.weekStartsOn}
          marked={new Set(occurrences.map(o => localDateKey(o.start, settings.calendarTimeZone)))}
          onSelect={onDate}
        />
      ) : null}

      {view === 'week' ? (
        <WeekList
          cursor={cursor}
          occurrences={occurrences}
          onSelect={onDate}
          onOpenEvent={onOpenEvent}
        />
      ) : null}

      {view === 'agenda' ? (
        <AgendaList occurrences={occurrences} onOpenEvent={onOpenEvent} />
      ) : null}

      {view === 'day' || view === 'month' ? (
        <View>
          <SectionHeader
            title={view === 'month' ? 'Selected day' : 'Schedule'}
            hint={conflicts.length > 0 ? `${conflicts.length} overlapping events` : undefined}
            actionLabel="Add event"
            onAction={() => onNewEvent()}
          />
          {dayOccurrences.length === 0 ? (
            <EmptyState
              title="Nothing scheduled"
              message="This day is open. Add an event or ask the assistant."
              actionLabel="New event"
              onAction={() => onNewEvent()}
              glyph="▤"
            />
          ) : (
            <View style={{gap: 8}}>
              {dayOccurrences.map(occurrence => (
                <Card
                  key={`${occurrence.eventId}-${occurrence.occurrenceStart}`}
                  onPress={() => onOpenEvent(occurrence.eventId)}
                  accentColor={occurrence.color}
                  accessibilityLabel={`${occurrence.title} at ${eventTimeLabel(occurrence.start, occurrence.end, occurrence.allDay, settings.calendarTimeZone, settings.clock24h)}`}>
                  <Row align="space-between">
                    <View style={{flex: 1}}>
                      <Txt variant="h3" numberOfLines={1}>
                        {occurrence.title}
                      </Txt>
                      <Txt variant="small" color="muted">
                        {eventTimeLabel(occurrence.start, occurrence.end, occurrence.allDay, settings.calendarTimeZone, settings.clock24h)}
                        {occurrence.location ? ` · ${occurrence.location}` : ''}
                      </Txt>
                    </View>
                    {occurrence.recurring ? (
                      <Txt variant="small" color="faint">
                        ↻
                      </Txt>
                    ) : null}
                  </Row>
                </Card>
              ))}
            </View>
          )}

          {free.length > 0 ? (
            <>
              <SectionHeader title="Free time" hint={`Inside ${minutesLabel(settings.workdayStart)}–${minutesLabel(settings.workdayEnd)}`} />
              <Row gap={6} style={{flexWrap: 'wrap'}}>
                {free.slice(0, 4).map(slot => (
                  <Pressable
                    key={slot.start}
                    onPress={() => onNewEvent(slot.start, slot.end)}
                    accessibilityRole="button"
                    accessibilityLabel={`Book free slot ${eventTimeLabel(slot.start, slot.end, false, settings.calendarTimeZone, settings.clock24h)}`}>
                    <Chip
                      label={`${eventTimeLabel(slot.start, slot.end, false, settings.calendarTimeZone, settings.clock24h)} · ${slot.minutes}m`}
                      onPress={() => onNewEvent(slot.start, slot.end)}
                    />
                  </Pressable>
                ))}
              </Row>
            </>
          ) : null}
        </View>
      ) : null}

      {view === 'day' && conflicts.length > 0 ? (
        <Card style={{marginTop: space.md}} accentColor={palette.danger}>
          <Txt variant="small" color="danger" style={{fontWeight: '700'}}>
            Double-booked
          </Txt>
          {conflicts.slice(0, 3).map((conflict, index) => (
            <Txt key={index} variant="small" color="muted">
              {conflict.a.title} overlaps {conflict.b.title}
            </Txt>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function NavButton({glyph, label, onPress}: {glyph: string; label: string; onPress: () => void}): React.JSX.Element {
  const palette = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: palette.line,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Txt variant="small" color="muted">
        {glyph}
      </Txt>
    </Pressable>
  );
}

function MonthPicker({
  cursor,
  todayKey,
  weekStartsOn,
  marked,
  onSelect,
}: {
  cursor: string;
  todayKey: string;
  weekStartsOn: 0 | 1;
  marked: Set<string>;
  onSelect: (key: string) => void;
}): React.JSX.Element {
  const palette = useTheme();
  const parts = parseDateKey(cursor);
  const keys = monthGridKeys(parts.year, parts.month, weekStartsOn);
  const weekdayLabels = keys.slice(0, 7).map(key => WEEKDAY_SHORT[new Date(`${key}T12:00:00Z`).getUTCDay()]);
  return (
    <View style={{marginBottom: space.sm}}>
      <View style={{flexDirection: 'row'}}>
        {weekdayLabels.map((label, index) => (
          <View key={`${label}-${index}`} style={{flex: 1, alignItems: 'center'}}>
            <Txt variant="micro" color="faint">
              {label?.slice(0, 1)}
            </Txt>
          </View>
        ))}
      </View>
      {Array.from({length: 6}, (_, row) => (
        <View key={row} style={{flexDirection: 'row'}}>
          {keys.slice(row * 7, row * 7 + 7).map(key => {
            const date = parseDateKey(key);
            const inMonth = date.month === parts.month;
            const isSelected = key === cursor;
            const isToday = key === todayKey;
            return (
              <Pressable
                key={key}
                onPress={() => onSelect(key)}
                accessibilityRole="button"
                accessibilityLabel={`${key}${isToday ? ', today' : ''}${marked.has(key) ? ', has events' : ''}`}
                style={{flex: 1, alignItems: 'center', paddingVertical: 6}}>
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isSelected ? palette.ink : isToday ? palette.surfaceAlt : 'transparent',
                  }}>
                  <Txt
                    variant="small"
                    style={{
                      color: isSelected ? palette.bg : inMonth ? palette.ink : palette.faint,
                      fontWeight: isToday || isSelected ? '700' : '400',
                    }}>
                    {date.day}
                  </Txt>
                </View>
                <View
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    marginTop: 2,
                    backgroundColor: marked.has(key) ? palette.accent : 'transparent',
                  }}
                />
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function WeekList({
  cursor,
  occurrences,
  onSelect,
  onOpenEvent,
}: {
  cursor: string;
  occurrences: Occurrence[];
  onSelect: (key: string) => void;
  onOpenEvent: (id: string) => void;
}): React.JSX.Element {
  const settings = useStore(state => state.settings);
  const palette = useTheme();
  const parts = parseDateKey(cursor);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const start = addDaysToDateKey(cursor, -((weekday - settings.weekStartsOn + 7) % 7));
  const days = Array.from({length: 7}, (_, index) => addDaysToDateKey(start, index));
  return (
    <View style={{gap: space.sm, marginBottom: space.md}}>
      {days.map(key => {
        const items = occurrences.filter(
          occurrence => localDateKey(occurrence.start, settings.calendarTimeZone) === key,
        );
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            accessibilityRole="button"
            accessibilityLabel={`${key}, ${items.length} events`}
            style={{
              borderLeftWidth: 2,
              borderLeftColor: key === cursor ? palette.accent : palette.line,
              paddingLeft: space.sm,
            }}>
            <Txt variant="micro" color={key === cursor ? 'accent' : 'muted'} style={{textTransform: 'uppercase'}}>
              {WEEKDAY_SHORT[new Date(`${key}T12:00:00Z`).getUTCDay()]} {parseDateKey(key).day}
            </Txt>
            {items.length === 0 ? (
              <Txt variant="small" color="faint">
                —
              </Txt>
            ) : (
              items.map(occurrence => (
                <Pressable
                  key={`${occurrence.eventId}-${occurrence.occurrenceStart}`}
                  onPress={() => onOpenEvent(occurrence.eventId)}
                  accessibilityRole="button"
                  accessibilityLabel={occurrence.title}>
                  <Txt variant="small" numberOfLines={1}>
                    {eventTimeLabel(occurrence.start, occurrence.end, occurrence.allDay, settings.calendarTimeZone, settings.clock24h)} · {occurrence.title}
                  </Txt>
                </Pressable>
              ))
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function AgendaList({
  occurrences,
  onOpenEvent,
}: {
  occurrences: Occurrence[];
  onOpenEvent: (id: string) => void;
}): React.JSX.Element {
  const settings = useStore(state => state.settings);
  const snapshot = useStore(state => state.snapshot);
  const now = snapshot?.now ?? Date.now();
  const future = occurrences.filter(occurrence => occurrence.end >= now);
  const grouped = new Map<string, Occurrence[]>();
  for (const occurrence of future) {
    const key = localDateKey(occurrence.start, settings.calendarTimeZone);
    const list = grouped.get(key) ?? [];
    list.push(occurrence);
    grouped.set(key, list);
  }
  if (grouped.size === 0) {
    return <EmptyState title="No upcoming events" message="The agenda is empty." glyph="▤" />;
  }
  return (
    <View style={{gap: space.md}}>
      {Array.from(grouped.entries()).map(([key, items]) => (
        <View key={key}>
          <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 4}}>
            {relativeDay(new Date(`${key}T12:00:00Z`).getTime(), now, 'UTC')}
          </Txt>
          {items.map(occurrence => (
            <Card
              key={`${occurrence.eventId}-${occurrence.occurrenceStart}`}
              onPress={() => onOpenEvent(occurrence.eventId)}
              style={{marginBottom: 6}}
              accentColor={occurrence.color}>
              <Txt variant="small" style={{fontWeight: '700'}} numberOfLines={1}>
                {occurrence.title}
              </Txt>
              <Txt variant="micro" color="muted">
                {eventTimeLabel(occurrence.start, occurrence.end, occurrence.allDay, settings.calendarTimeZone, settings.clock24h)}
              </Txt>
            </Card>
          ))}
        </View>
      ))}
    </View>
  );
}
