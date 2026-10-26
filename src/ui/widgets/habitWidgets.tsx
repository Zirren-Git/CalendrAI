/** Habit and routine widgets (21–26). */
import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Txt} from '../components';
import {space, useTheme} from '../theme';
import {Ring, WidgetEmpty} from './primitives';
import {
  habitLoggedOn,
  habitProgress,
  habitScoreToday,
  habitsToday,
  routineFor,
  weekKeys,
} from './data';
import {useStore} from '../../state/store';
import {parseDateKey} from '../../domain/time';
import type {WidgetContext} from './types';

export function DailyHabitChecklistWidget(ctx: WidgetContext): React.JSX.Element {
  const toggleHabit = useStore(state => state.toggleHabit);
  const habits = habitsToday(ctx.snapshot);
  if (habits.length === 0) {
    return (
      <WidgetEmpty text="No habits scheduled today." actionLabel="Create one" onAction={() => ctx.navigate('habits')} />
    );
  }
  return (
    <View style={{gap: 4}}>
      {habits.slice(0, 6).map(habit => {
        const done = habitLoggedOn(ctx.snapshot, habit.id, ctx.snapshot.todayKey);
        return (
          <Pressable
            key={habit.id}
            onPress={() => toggleHabit(habit.id, ctx.snapshot.todayKey)}
            accessibilityRole="checkbox"
            accessibilityState={{checked: done}}
            accessibilityLabel={`${habit.name}${done ? ', done' : ''}`}
            style={styles.habitRow}>
            <View
              style={[
                styles.habitBox,
                {borderColor: done ? habit.color : ctx.palette.line, backgroundColor: done ? habit.color : 'transparent'},
              ]}>
              <Txt variant="micro" style={{color: done ? '#FFFFFF' : habit.color, fontWeight: '800'}}>
                {habit.emoji}
              </Txt>
            </View>
            <Txt
              variant="small"
              numberOfLines={1}
              style={{flex: 1, color: done ? ctx.palette.faint : ctx.palette.ink, textDecorationLine: done ? 'line-through' : 'none'}}>
              {habit.name}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function HabitStreakWidget(ctx: WidgetContext): React.JSX.Element {
  const habits = habitsToday(ctx.snapshot);
  if (habits.length === 0) {
    return <WidgetEmpty text="Add a habit to start a streak." />;
  }
  const withProgress = habits.map(habit => ({habit, progress: habitProgress(ctx.snapshot, habit)}));
  withProgress.sort((a, b) => b.progress.streak - a.progress.streak);
  const best = withProgress[0]!;
  return (
    <View style={{gap: 4}}>
      <Txt variant="h1" style={{color: best.habit.color}}>
        {best.progress.streak}
      </Txt>
      <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
        day streak · {best.habit.name}
      </Txt>
      <Txt variant="small" color="faint">
        Best {best.progress.bestStreak} · {best.progress.completedThisWeek}/{best.progress.targetPerWeek} this week
      </Txt>
    </View>
  );
}

export function WeeklyHabitGridWidget(ctx: WidgetContext): React.JSX.Element {
  const toggleHabit = useStore(state => state.toggleHabit);
  const habits = ctx.snapshot.habits.filter(habit => !habit.archived).slice(0, 5);
  if (habits.length === 0) {
    return <WidgetEmpty text="No habits to show yet." />;
  }
  const keys = weekKeys(ctx.snapshot.todayKey, ctx.settings.weekStartsOn);
  return (
    <View style={{gap: 5}}>
      <View style={{flexDirection: 'row', paddingLeft: 74}}>
        {keys.map(key => (
          <Txt key={key} variant="micro" color="faint" align="center" style={{flex: 1}}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'][parseDateKey(key).day % 7]}
          </Txt>
        ))}
      </View>
      {habits.map(habit => (
        <View key={habit.id} style={{flexDirection: 'row', alignItems: 'center'}}>
          <Txt variant="micro" numberOfLines={1} style={{width: 74}}>
            {habit.emoji} {habit.name}
          </Txt>
          {keys.map(key => {
            const done = habitLoggedOn(ctx.snapshot, habit.id, key);
            const future = key > ctx.snapshot.todayKey;
            return (
              <Pressable
                key={key}
                disabled={future}
                onPress={() => toggleHabit(habit.id, key)}
                accessibilityRole="checkbox"
                accessibilityState={{checked: done, disabled: future}}
                accessibilityLabel={`${habit.name} on ${key}`}
                style={styles.gridCell}>
                <View
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    borderWidth: 1,
                    borderColor: done ? habit.color : ctx.palette.line,
                    backgroundColor: done ? habit.color : future ? 'transparent' : ctx.palette.surfaceAlt,
                    opacity: future ? 0.4 : 1,
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

export function HabitScoreWidget(ctx: WidgetContext): React.JSX.Element {
  const habits = habitsToday(ctx.snapshot);
  if (habits.length === 0) {
    return <WidgetEmpty text="No habits scheduled." />;
  }
  const score = habitScoreToday(ctx.snapshot);
  const weekly = ctx.snapshot.habits
    .filter(habit => !habit.archived)
    .map(habit => habitProgress(ctx.snapshot, habit))
    .reduce(
      (acc, progress) => ({
        done: acc.done + progress.completedThisWeek,
        target: acc.target + progress.targetPerWeek,
      }),
      {done: 0, target: 0},
    );
  return (
    <View style={{gap: space.sm}}>
      <Ring
        progress={score}
        label={`${Math.round(score * 100)}%`}
        caption={`${habits.filter(habit => habitLoggedOn(ctx.snapshot, habit.id, ctx.snapshot.todayKey)).length} of ${habits.length} habits today`}
        color={ctx.palette.sage}
      />
      <Txt variant="micro" color="faint">
        Week: {weekly.done}/{weekly.target} check-ins
      </Txt>
    </View>
  );
}

function RoutineWidget(ctx: WidgetContext, kind: 'morning' | 'evening'): React.JSX.Element {
  const setRoutineLog = useStore(state => state.toggleRoutineItem);
  const data = routineFor(ctx.snapshot, kind);
  if (!data) {
    return <WidgetEmpty text={`No ${kind} routine.`} actionLabel="Open habits" onAction={() => ctx.navigate('habits')} />;
  }
  const {routine, completed} = data;
  if (routine.items.length === 0) {
    return <WidgetEmpty text="This routine has no steps yet." />;
  }
  return (
    <View style={{gap: 3}}>
      {routine.items.map(item => {
        const done = completed.includes(item);
        return (
          <Pressable
            key={item}
            onPress={() => setRoutineLog(routine.id, item, !done)}
            accessibilityRole="checkbox"
            accessibilityState={{checked: done}}
            accessibilityLabel={item}
            style={styles.habitRow}>
            <View
              style={[
                styles.routineDot,
                {borderColor: done ? ctx.palette.sage : ctx.palette.line, backgroundColor: done ? ctx.palette.sage : 'transparent'},
              ]}
            />
            <Txt
              variant="small"
              numberOfLines={2}
              style={{flex: 1, color: done ? ctx.palette.faint : ctx.palette.ink, textDecorationLine: done ? 'line-through' : 'none'}}>
              {item}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MorningRoutineWidget(ctx: WidgetContext): React.JSX.Element {
  return RoutineWidget(ctx, 'morning');
}

export function EveningRoutineWidget(ctx: WidgetContext): React.JSX.Element {
  return RoutineWidget(ctx, 'evening');
}

const styles = StyleSheet.create({
  habitRow: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, minHeight: 30},
  habitBox: {width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center'},
  routineDot: {width: 16, height: 16, borderRadius: 8, borderWidth: 1.5},
  gridCell: {flex: 1, alignItems: 'center', paddingVertical: 3},
});
