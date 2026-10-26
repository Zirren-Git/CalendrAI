/** Focus and time widgets (27–32). */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Txt} from '../components';
import {radius, space, useTheme} from '../theme';
import {MiniList, Ring, Stat, WidgetEmpty} from './primitives';
import {focusGoalMinutes, focusMinutesToday, focusSessionsToday} from './data';
import {minutesLabel} from '../format';
import {atLocalMinute, formatTime, minutesIntoLocalDay} from '../../domain/time';
import {useStore} from '../../state/store';
import type {WidgetContext} from './types';

function StartButton({
  label,
  onPress,
  tone,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  tone?: string;
  accessibilityLabel?: string;
}): React.JSX.Element {
  const palette = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({pressed}) => [
        styles.startButton,
        {backgroundColor: tone ?? palette.ink, opacity: pressed ? 0.8 : 1},
      ]}>
      <Txt variant="micro" style={{color: palette.bg, fontWeight: '800'}}>
        {label}
      </Txt>
    </Pressable>
  );
}

function elapsedLabel(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function PomodoroTimerWidget(ctx: WidgetContext): React.JSX.Element {
  const beginFocus = useStore(state => state.beginFocus);
  const active = ctx.snapshot.activeFocus;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => tick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (active) {
    return (
      <View style={{gap: 4}}>
        <Stat value={elapsedLabel(active.startedAt)} label={`${active.kind} in progress`} color={ctx.palette.accent} />
        <Txt variant="small" numberOfLines={1}>
          {active.label}
        </Txt>
        <Txt variant="micro" color="faint">
          {active.plannedMinutes} min planned
        </Txt>
        <StartButton
          label="OPEN TIMER"
          tone={ctx.palette.accent}
          onPress={() => ctx.navigate('focus')}
          accessibilityLabel="Open focus timer"
        />
      </View>
    );
  }
  return (
    <View style={{gap: 6}}>
      <Stat value={String(ctx.settings.pomodoroMinutes)} label="minute pomodoro" />
      <Txt variant="micro" color="faint">
        {focusSessionsToday(ctx.snapshot)} sessions · {minutesLabel(Math.round(focusMinutesToday(ctx.snapshot)))} today
      </Txt>
      <StartButton
        label="START"
        onPress={() => {
          void beginFocus(ctx.settings.pomodoroMinutes, 'Pomodoro', 'focus', null).then(() => ctx.navigate('focus'));
        }}
        accessibilityLabel={`Start a ${ctx.settings.pomodoroMinutes} minute pomodoro`}
      />
    </View>
  );
}

export function FocusTimerWidget(ctx: WidgetContext): React.JSX.Element {
  const beginFocus = useStore(state => state.beginFocus);
  const minutes = ctx.settings.pomodoroMinutes * 2;
  if (ctx.snapshot.activeFocus) {
    return (
      <View style={{gap: 4}}>
        <Stat value={elapsedLabel(ctx.snapshot.activeFocus.startedAt)} label="focused" />
        <StartButton label="OPEN" onPress={() => ctx.navigate('focus')} accessibilityLabel="Open focus timer" />
      </View>
    );
  }
  return (
    <View style={{gap: 6}}>
      <Txt variant="small" color="muted">
        Deep work block
      </Txt>
      <Stat value={String(minutes)} label="minutes" />
      <StartButton
        label="BEGIN"
        onPress={() => {
          void beginFocus(minutes, 'Deep work', 'focus', null).then(() => ctx.navigate('focus'));
        }}
        accessibilityLabel={`Start a ${minutes} minute focus block`}
      />
    </View>
  );
}

export function FocusSessionsWidget(ctx: WidgetContext): React.JSX.Element {
  const sessions = ctx.snapshot.focusToday.filter(session => session.kind === 'focus' && session.endedAt);
  const total = focusMinutesToday(ctx.snapshot);
  if (sessions.length === 0) {
    return (
      <WidgetEmpty
        text="No focus sessions logged today."
        actionLabel="Start a session"
        onAction={() => ctx.navigate('focus')}
      />
    );
  }
  return (
    <View style={{gap: space.sm}}>
      <Ring
        progress={total / focusGoalMinutes(ctx.settings)}
        label={`${Math.round(total)}m`}
        caption={`Goal ${minutesLabel(focusGoalMinutes(ctx.settings))}`}
        color={ctx.palette.gold}
        size={62}
      />
      <MiniList
        items={sessions.slice(-4).reverse().map(session => ({
          key: session.id,
          title: session.label,
          meta: minutesLabel(Math.round(((session.endedAt ?? session.startedAt) - session.startedAt) / 60_000)),
          tone: ctx.palette.gold,
        }))}
      />
    </View>
  );
}

export function BreakReminderWidget(ctx: WidgetContext): React.JSX.Element {
  const palette = useTheme();
  const last = ctx.snapshot.recentSessions.find(session => session.kind === 'focus' && session.endedAt);
  if (!last?.endedAt) {
    return <WidgetEmpty text="A break timer appears after your first focus session." />;
  }
  const sinceMinutes = Math.max(0, Math.round((ctx.snapshot.now - last.endedAt) / 60_000));
  const due = sinceMinutes >= ctx.settings.shortBreakMinutes;
  return (
    <View style={{gap: 4}}>
      <Txt variant="micro" style={{color: due ? palette.danger : palette.sage, fontWeight: '700'}}>
        {due ? 'BREAK DUE' : 'RECOVERING'}
      </Txt>
      <Txt variant="h3">
        {sinceMinutes < 1 ? 'Just finished' : `${sinceMinutes} min since focus`}
      </Txt>
      <Txt variant="small" color="muted">
        {due
          ? `Take ${ctx.settings.shortBreakMinutes} minutes away from the screen.`
          : `Next break at ${ctx.settings.shortBreakMinutes} minutes.`}
      </Txt>
    </View>
  );
}

export function TimeBudgetWidget(ctx: WidgetContext): React.JSX.Element {
  const palette = useTheme();
  const minutesNow = minutesIntoLocalDay(ctx.snapshot.now, ctx.settings.calendarTimeZone);
  const remaining = Math.max(0, ctx.settings.workdayEnd - minutesNow);
  const planned = ctx.snapshot.occurrences
    .filter(
      occurrence =>
        !occurrence.allDay &&
        occurrence.start >= atLocalMinute(ctx.snapshot.now, ctx.settings.calendarTimeZone, ctx.settings.workdayStart) &&
        occurrence.start <= atLocalMinute(ctx.snapshot.now, ctx.settings.calendarTimeZone, ctx.settings.workdayEnd),
    )
    .reduce((sum, occurrence) => sum + (occurrence.end - occurrence.start) / 60_000, 0);
  const ratio = remaining === 0 ? 1 : Math.min(1, planned / remaining);
  return (
    <View style={{gap: 6}}>
      <Stat value={minutesLabel(remaining)} label="workday left" color={ratio > 0.9 ? palette.danger : palette.ink} />
      <View style={{height: 7, borderRadius: 4, backgroundColor: palette.surfaceAlt, overflow: 'hidden'}}>
        <View style={{width: `${ratio * 100}%`, height: 7, backgroundColor: ratio > 0.9 ? palette.danger : palette.sky}} />
      </View>
      <Txt variant="micro" color="faint">
        {minutesLabel(Math.round(planned))} of meetings remaining
      </Txt>
    </View>
  );
}

export function TimeTrackingSummaryWidget(ctx: WidgetContext): React.JSX.Element {
  const entries = ctx.snapshot.timeEntriesToday.filter(entry => entry.endedAt);
  if (entries.length === 0) {
    return <WidgetEmpty text="No tracked time today." actionLabel="Open focus" onAction={() => ctx.navigate('focus')} />;
  }
  const byCategory = new Map<string, number>();
  for (const entry of entries) {
    const minutes = Math.max(0, ((entry.endedAt ?? entry.startedAt) - entry.startedAt) / 60_000);
    byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + minutes);
  }
  const total = Array.from(byCategory.values()).reduce((sum, value) => sum + value, 0);
  return (
    <View style={{gap: 5}}>
      {Array.from(byCategory.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([category, minutes]) => (
          <View key={category} style={{gap: 2}}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
              <Txt variant="small" style={{textTransform: 'capitalize'}}>
                {category}
              </Txt>
              <Txt variant="micro" color="muted">
                {minutesLabel(Math.round(minutes))}
              </Txt>
            </View>
            <View style={{height: 5, borderRadius: 3, backgroundColor: ctx.palette.surfaceAlt, overflow: 'hidden'}}>
              <View
                style={{width: `${(minutes / total) * 100}%`, height: 5, backgroundColor: ctx.palette.sky}}
              />
            </View>
          </View>
        ))}
    </View>
  );
}

/** The running timer's wall-clock start, shown on the focus screen. */
export function sessionStartLabel(startedAt: number, timeZone: string, clock24h: boolean): string {
  return formatTime(startedAt, timeZone, clock24h);
}

const styles = StyleSheet.create({
  startButton: {
    minHeight: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    alignSelf: 'flex-start',
  },
});
