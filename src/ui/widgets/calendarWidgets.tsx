/** Calendar widgets (1–10). Every widget renders real occurrences from the snapshot. */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Txt} from '../components';
import {radius, space, useTheme} from '../theme';
import {MiniList, Stat, WidgetEmpty} from './primitives';
import {
  freeSlots,
  monthGridKeys,
  nextOccurrence,
  occurrencesOn,
  timedToday,
  todayOccurrences,
  weekKeys,
} from './data';
import {MONTH_SHORT, WEEKDAY_SHORT, eventTimeLabel, minutesLabel, relativeDay, shortDate} from '../format';
import {addDaysToDateKey, parseDateKey} from '../../domain/time';
import {formatTime} from '../../domain/time';
import type {WidgetContext} from './types';

export function TodayAgendaWidget(ctx: WidgetContext): React.JSX.Element {
  const {snapshot, settings, navigate, palette} = ctx;
  const items = todayOccurrences(snapshot, settings);
  if (items.length === 0) {
    return <WidgetEmpty text="Nothing on the calendar today." actionLabel="Add an event" onAction={() => navigate('event', {})} />;
  }
  return (
    <MiniList
      items={items.slice(0, 6).map(occurrence => ({
        key: `${occurrence.eventId}-${occurrence.occurrenceStart}`,
        title: occurrence.title,
        meta: occurrence.allDay ? 'All day' : formatTime(occurrence.start, settings.calendarTimeZone, settings.clock24h),
        tone: occurrence.color || palette.accent,
        accessibilityLabel: `${occurrence.title}, ${occurrence.allDay ? 'all day' : formatTime(occurrence.start, settings.calendarTimeZone, settings.clock24h)}`,
        onPress: () => navigate('event', {id: occurrence.eventId}),
      }))}
    />
  );
}

export function DayTimelineWidget(ctx: WidgetContext): React.JSX.Element {
  const {snapshot, settings, navigate, config} = ctx;
  const palette = useTheme();
  const startHour = typeof config.startHour === 'number' ? config.startHour : 8;
  const endHour = typeof config.endHour === 'number' ? config.endHour : 20;
  const spanMinutes = Math.max(60, (endHour - startHour) * 60);
  const timed = timedToday(snapshot, settings);
  const height = 150;
  return (
    <View>
      <View style={[styles.timeline, {height, borderColor: palette.line}]}>
        {[0, 0.25, 0.5, 0.75, 1].map(fraction => (
          <View
            key={fraction}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: fraction * height,
              height: StyleSheet.hairlineWidth,
              backgroundColor: palette.line,
            }}
          />
        ))}
        {timed.map(occurrence => {
          const minutesFromStart = minutesIntoWindow(occurrence.start, settings.calendarTimeZone, startHour);
          const duration = Math.max(12, (occurrence.end - occurrence.start) / 60_000);
          const top = Math.max(0, Math.min(height - 8, (minutesFromStart / spanMinutes) * height));
          const blockHeight = Math.max(8, Math.min(height - top, (duration / spanMinutes) * height));
          return (
            <Pressable
              key={`${occurrence.eventId}-${occurrence.occurrenceStart}`}
              onPress={() => navigate('event', {id: occurrence.eventId})}
              accessibilityRole="button"
              accessibilityLabel={`${occurrence.title} at ${formatTime(occurrence.start, settings.calendarTimeZone, settings.clock24h)}`}
              style={{
                position: 'absolute',
                left: 2,
                right: 2,
                top,
                height: blockHeight,
                backgroundColor: occurrence.color || palette.accent,
                borderRadius: 5,
                paddingHorizontal: 5,
                justifyContent: 'center',
                overflow: 'hidden',
              }}>
              <Txt variant="micro" style={{color: '#FFF8F4', fontWeight: '700'}} numberOfLines={1}>
                {occurrence.title}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.timelineLabels}>
        <Txt variant="micro" color="faint">
          {startHour}:00
        </Txt>
        <Txt variant="micro" color="faint">
          {endHour}:00
        </Txt>
      </View>
    </View>
  );
}

function minutesIntoWindow(ms: number, timeZone: string, startHour: number): number {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {timeZone, hour: 'numeric', hour12: false}).format(new Date(ms)),
  );
  const minute = Number(
    new Intl.DateTimeFormat('en-US', {timeZone, minute: 'numeric'}).format(new Date(ms)),
  );
  return (hour % 24) * 60 + minute - startHour * 60;
}

export function WeekStripWidget(ctx: WidgetContext): React.JSX.Element {
  const {snapshot, settings, navigate} = ctx;
  const palette = useTheme();
  const keys = weekKeys(snapshot.todayKey, settings.weekStartsOn);
  return (
    <View style={{flexDirection: 'row', gap: 4}}>
      {keys.map(key => {
        const count = occurrencesOn(snapshot, key, settings).length;
        const isToday = key === snapshot.todayKey;
        const parts = parseDateKey(key);
        return (
          <Pressable
            key={key}
            onPress={() => navigate('calendar', {date: key})}
            accessibilityRole="button"
            accessibilityLabel={`${shortDate(new Date(`${key}T12:00:00Z`).getTime(), 'UTC')}, ${count} events`}
            style={[
              styles.weekDay,
              {
                backgroundColor: isToday ? palette.ink : palette.surfaceAlt,
                borderColor: isToday ? palette.ink : palette.line,
              },
            ]}>
            <Txt variant="micro" style={{color: isToday ? palette.bg : palette.faint}}>
              {WEEKDAY_SHORT[new Date(`${key}T12:00:00Z`).getUTCDay()]}
            </Txt>
            <Txt variant="h3" style={{color: isToday ? palette.bg : palette.ink}}>
              {parts.day}
            </Txt>
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 3,
                backgroundColor: count > 0 ? (isToday ? palette.bg : palette.accent) : 'transparent',
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export function WeekAgendaWidget(ctx: WidgetContext): React.JSX.Element {
  const {snapshot, settings} = ctx;
  const days = weekKeys(snapshot.todayKey, settings.weekStartsOn);
  const rows: React.ReactElement[] = [];
  for (const key of days) {
    const items = occurrencesOn(snapshot, key, settings);
    if (items.length === 0) {
      continue;
    }
    rows.push(
      <View key={key} style={{marginBottom: space.sm}}>
        <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
          {relativeDay(new Date(`${key}T12:00:00Z`).getTime(), snapshot.now, 'UTC')}
        </Txt>
        <MiniList
          items={items.slice(0, 3).map(occurrence => ({
            key: `${occurrence.eventId}-${occurrence.occurrenceStart}`,
            title: occurrence.title,
            meta: occurrence.allDay ? 'All day' : formatTime(occurrence.start, settings.calendarTimeZone, settings.clock24h),
            tone: occurrence.color,
          }))}
        />
      </View>,
    );
  }
  return rows.length > 0 ? <View>{rows}</View> : <WidgetEmpty text="A clear week ahead." />;
}

export function MonthGridWidget(ctx: WidgetContext): React.JSX.Element {
  const {snapshot, settings, navigate, config} = ctx;
  const palette = useTheme();
  const today = parseDateKey(snapshot.todayKey);
  const monthOffset = typeof config.monthOffset === 'number' ? config.monthOffset : 0;
  const target = new Date(Date.UTC(today.year, today.month - 1 + monthOffset, 1));
  const keys = monthGridKeys(target.getUTCFullYear(), target.getUTCMonth() + 1, settings.weekStartsOn);
  const headers = weekKeys(snapshot.todayKey, settings.weekStartsOn).map(
    key => WEEKDAY_SHORT[new Date(`${key}T12:00:00Z`).getUTCDay()],
  );
  return (
    <View>
      <Txt variant="small" color="muted" style={{marginBottom: 4}}>
        {MONTH_SHORT[target.getUTCMonth()]} {target.getUTCFullYear()}
      </Txt>
      <View style={{flexDirection: 'row'}}>
        {headers.map((label, index) => (
          <View key={`${label}-${index}`} style={styles.monthCell}>
            <Txt variant="micro" color="faint" align="center">
              {label?.slice(0, 1)}
            </Txt>
          </View>
        ))}
      </View>
      {Array.from({length: 6}, (_, row) => (
        <View key={row} style={{flexDirection: 'row'}}>
          {keys.slice(row * 7, row * 7 + 7).map(key => {
            const parts = parseDateKey(key);
            const inMonth = parts.month === target.getUTCMonth() + 1;
            const isToday = key === snapshot.todayKey;
            const count = occurrencesOn(snapshot, key, settings).length;
            return (
              <Pressable
                key={key}
                onPress={() => navigate('calendar', {date: key})}
                accessibilityRole="button"
                accessibilityLabel={`${key}, ${count} events`}
                style={[styles.monthCell, isToday ? {backgroundColor: palette.surfaceAlt, borderRadius: 6} : null]}>
                <Txt
                  variant="small"
                  align="center"
                  style={{color: inMonth ? (isToday ? palette.accent : palette.ink) : palette.faint, fontWeight: isToday ? '700' : '400'}}>
                  {parts.day}
                </Txt>
                <View
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    alignSelf: 'center',
                    backgroundColor: count > 0 ? palette.accent : 'transparent',
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

export function NextEventWidget(ctx: WidgetContext): React.JSX.Element {
  const {snapshot, settings, navigate} = ctx;
  const palette = useTheme();
  const next = nextOccurrence(snapshot, settings);
  if (!next) {
    return <WidgetEmpty text="No upcoming events." actionLabel="Plan something" onAction={() => navigate('event', {})} />;
  }
  return (
    <Pressable
      onPress={() => navigate('event', {id: next.eventId})}
      accessibilityRole="button"
      accessibilityLabel={`Next event: ${next.title}`}
      style={{gap: 2}}>
      <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
        {relativeDay(next.start, snapshot.now, settings.calendarTimeZone)}
      </Txt>
      <Txt variant="h3" numberOfLines={2}>
        {next.title}
      </Txt>
      <Txt variant="small" color="muted">
        {eventTimeLabel(next.start, next.end, next.allDay, settings.calendarTimeZone, settings.clock24h)}
      </Txt>
      {next.location ? (
        <Txt variant="small" color="faint" numberOfLines={1}>
          {next.location}
        </Txt>
      ) : null}
      <View style={{height: 4, backgroundColor: next.color || palette.accent, borderRadius: 2, marginTop: 6}} />
    </Pressable>
  );
}

export function UpcomingEventsWidget(ctx: WidgetContext): React.JSX.Element {
  const {snapshot, settings, navigate} = ctx;
  const upcoming = snapshot.occurrences.filter(occurrence => occurrence.end > snapshot.now).slice(0, 6);
  if (upcoming.length === 0) {
    return <WidgetEmpty text="The next days are open." />;
  }
  return (
    <MiniList
      items={upcoming.map(occurrence => ({
        key: `${occurrence.eventId}-${occurrence.occurrenceStart}`,
        title: occurrence.title,
        meta: `${relativeDay(occurrence.start, snapshot.now, settings.calendarTimeZone)} · ${
          occurrence.allDay ? 'All day' : formatTime(occurrence.start, settings.calendarTimeZone, settings.clock24h)
        }`,
        tone: occurrence.color,
        onPress: () => navigate('event', {id: occurrence.eventId}),
      }))}
    />
  );
}

export function EventCountdownWidget(ctx: WidgetContext): React.JSX.Element {
  const {snapshot, settings} = ctx;
  const palette = useTheme();
  const [now, setNow] = useState(snapshot.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const next = snapshot.occurrences.filter(occurrence => occurrence.start > now).sort((a, b) => a.start - b.start)[0];
  if (!next) {
    return <WidgetEmpty text="Nothing scheduled next." />;
  }
  const minutes = Math.max(0, Math.round((next.start - now) / 60_000));
  const label =
    minutes >= 1440 ? `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h` : minutes >= 60
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : `${minutes}m`;
  return (
    <View style={{gap: 2}}>
      <Stat value={label} label="until next event" color={palette.accent} />
      <Txt variant="small" numberOfLines={1}>
        {next.title}
      </Txt>
      <Txt variant="micro" color="muted">
        {formatTime(next.start, settings.calendarTimeZone, settings.clock24h)} ·{' '}
        {relativeDay(next.start, now, settings.calendarTimeZone)}
      </Txt>
    </View>
  );
}

export function FreeTimeWidget(ctx: WidgetContext): React.JSX.Element {
  const {snapshot, settings, navigate, config} = ctx;
  const minMinutes = typeof config.minMinutes === 'number' ? config.minMinutes : 30;
  const slots = freeSlots(snapshot, settings, snapshot.todayKey, minMinutes);
  if (slots.length === 0) {
    return <WidgetEmpty text={`No free block of ${minutesLabel(minMinutes)} left today.`} />;
  }
  return (
    <MiniList
      items={slots.slice(0, 4).map(slot => ({
        key: String(slot.start),
        title: eventTimeLabel(slot.start, slot.end, false, settings.calendarTimeZone, settings.clock24h),
        meta: minutesLabel(slot.minutes),
        tone: ctx.palette.sage,
        accessibilityLabel: `Free ${minutesLabel(slot.minutes)}`,
        onPress: () => navigate('event', {start: slot.start, end: slot.end}),
      }))}
    />
  );
}

export function CalendarHeatmapWidget(ctx: WidgetContext): React.JSX.Element {
  const {snapshot, settings} = ctx;
  const palette = useTheme();
  const keys = Array.from({length: 14}, (_, index) =>
    addDaysToDateKey(snapshot.todayKey, index - 13),
  );
  const loads = keys.map(key => {
    const minutes = occurrencesOn(snapshot, key, settings)
      .filter(occurrence => !occurrence.allDay)
      .reduce((sum, occurrence) => sum + (occurrence.end - occurrence.start) / 60_000, 0);
    return minutes;
  });
  const max = Math.max(1, ...loads);
  return (
    <View style={{gap: space.sm}}>
      <View style={{flexDirection: 'row', gap: 3, flexWrap: 'wrap'}}>
        {keys.map((key, index) => {
          const intensity = loads[index]! / max;
          return (
            <View
              key={key}
              accessibilityLabel={`${key}: ${Math.round(loads[index]!)} scheduled minutes`}
              style={{
                width: 15,
                height: 15,
                borderRadius: 3,
                backgroundColor:
                  loads[index] === 0 ? palette.surfaceAlt : `${palette.accent}${alphaFor(intensity)}`,
              }}
            />
          );
        })}
      </View>
      <Txt variant="micro" color="faint">
        Last 14 days · busiest {Math.round(max)} min
      </Txt>
    </View>
  );
}

function alphaFor(intensity: number): string {
  const alpha = Math.round(60 + Math.min(1, intensity) * 155);
  return alpha.toString(16).padStart(2, '0').toUpperCase();
}

const styles = StyleSheet.create({
  timeline: {borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden'},
  timelineLabels: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 4},
  weekDay: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  monthCell: {flex: 1, paddingVertical: 4, alignItems: 'center'},
});
