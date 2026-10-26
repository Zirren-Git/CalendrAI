/** Planning and insight widgets (39–48). */
import React, {useState} from 'react';
import {Pressable, TextInput, View} from 'react-native';
import {Txt} from '../components';
import {space, useTheme} from '../theme';
import {MiniList, Ring, Stat, WidgetEmpty} from './primitives';
import {
  activeGoals,
  averageLoad,
  dayLoad,
  focusMinutesToday,
  freeSlots,
  habitScoreToday,
  nextOccurrence,
  productivity,
  tasksToday,
  weekSummary,
} from './data';
import {minutesLabel, percent, relativeDay} from '../format';
import {formatTime} from '../../domain/time';
import {useStore} from '../../state/store';
import type {WidgetContext} from './types';

export function DailyPlanWidget(ctx: WidgetContext): React.JSX.Element {
  const next = nextOccurrence(ctx.snapshot, ctx.settings);
  const tasks = tasksToday(ctx.snapshot, ctx.settings);
  const habits = ctx.snapshot.habits.filter(habit => !habit.archived);
  const load = dayLoad(ctx.snapshot, ctx.settings);
  return (
    <View style={{gap: 6}}>
      <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
        {ctx.snapshot.todayKey}
      </Txt>
      <Txt variant="small" numberOfLines={2}>
        {ctx.snapshot.intention?.text?.trim() || 'No intention set yet.'}
      </Txt>
      <MiniList
        items={[
          ...(next
            ? [
                {
                  key: 'next',
                  title: next.title,
                  meta: formatTime(next.start, ctx.settings.calendarTimeZone, ctx.settings.clock24h),
                  tone: ctx.palette.accent,
                },
              ]
            : []),
          ...tasks.slice(0, 2).map(task => ({
            key: task.id,
            title: task.title,
            meta: 'task',
            tone: ctx.palette.gold,
          })),
        ]}
      />
      <Txt variant="micro" color="faint">
        {load.meetingCount} events · {minutesLabel(load.scheduledMinutes)} booked ·{' '}
        {minutesLabel(Math.round(focusMinutesToday(ctx.snapshot)))} focus ·{' '}
        {habits.length > 0 ? `${Math.round(habitScoreToday(ctx.snapshot) * 100)}% habits` : 'no habits yet'}
      </Txt>
    </View>
  );
}

export function DailyIntentionWidget(ctx: WidgetContext): React.JSX.Element {
  const palette = useTheme();
  const saveIntention = useStore(state => state.saveIntention);
  const [text, setText] = useState(ctx.snapshot.intention?.text ?? '');
  const [saved, setSaved] = useState(false);
  return (
    <View style={{gap: 5}}>
      <TextInput
        value={text}
        onChangeText={value => {
          setText(value);
          setSaved(false);
        }}
        placeholder="Today I want to…"
        placeholderTextColor={palette.faint}
        accessibilityLabel="Daily intention"
        onSubmitEditing={() => {
          void saveIntention(text).then(() => setSaved(true));
        }}
        style={{
          borderWidth: 1,
          borderColor: palette.line,
          backgroundColor: palette.surfaceAlt,
          color: palette.ink,
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 8,
          fontSize: 14,
        }}
      />
      <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
        <Txt variant="micro" color={saved ? 'sage' : 'faint'}>
          {saved ? 'Saved' : 'One sentence is enough'}
        </Txt>
        <Pressable
          onPress={() => void saveIntention(text).then(() => setSaved(true))}
          accessibilityRole="button"
          accessibilityLabel="Save intention">
          <Txt variant="micro" color="accent" style={{fontWeight: '800'}}>
            SET
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

export function GoalProgressWidget(ctx: WidgetContext): React.JSX.Element {
  const bumpGoal = useStore(state => state.bumpGoal);
  const goals = activeGoals(ctx.snapshot);
  if (goals.length === 0) {
    return <WidgetEmpty text="No active goals." actionLabel="Add a goal" onAction={() => ctx.navigate('plan')} />;
  }
  return (
    <View style={{gap: space.sm}}>
      {goals.slice(0, 3).map(goal => {
        const ratio = goal.target === 0 ? 0 : goal.current / goal.target;
        return (
          <View key={goal.id} style={{gap: 3}}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
              <Txt variant="small" numberOfLines={1} style={{flex: 1}}>
                {goal.title}
              </Txt>
              <Pressable
                onPress={() => void bumpGoal(goal, 1)}
                accessibilityRole="button"
                accessibilityLabel={`Add one to ${goal.title}`}
                hitSlop={8}
                style={{paddingHorizontal: 6}}>
                <Txt variant="small" color="accent" style={{fontWeight: '800'}}>
                  +1
                </Txt>
              </Pressable>
            </View>
            <View style={{height: 5, borderRadius: 3, backgroundColor: ctx.palette.surfaceAlt, overflow: 'hidden'}}>
              <View style={{width: `${Math.min(1, ratio) * 100}%`, height: 5, backgroundColor: ctx.palette.plum}} />
            </View>
            <Txt variant="micro" color="faint">
              {goal.current} / {goal.target} {goal.metricUnit}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

export function WeeklyReviewWidget(ctx: WidgetContext): React.JSX.Element {
  const summary = weekSummary(ctx.snapshot, ctx.settings);
  const reflection = ctx.snapshot.reflection;
  return (
    <Pressable
      onPress={() => ctx.navigate('plan', {tab: 'review'})}
      accessibilityRole="button"
      accessibilityLabel="Open weekly review"
      style={{gap: 5}}>
      <Stat value={String(summary.tasksCompleted)} label="tasks this week" />
      <Txt variant="micro" color="faint">
        {minutesLabel(Math.round(summary.focusMinutes))} focus · {percent(summary.habitRate)} habits · avg{' '}
        {minutesLabel(summary.averageScheduledMinutes)} booked
      </Txt>
      <Txt variant="small" numberOfLines={2} color={reflection?.wins ? 'ink' : 'faint'}>
        {reflection?.wins?.trim() ? `Wins: ${reflection.wins}` : 'Write your review for this week…'}
      </Txt>
    </Pressable>
  );
}

export function ProductivityScoreWidget(ctx: WidgetContext): React.JSX.Element {
  const result = productivity(ctx.snapshot, ctx.settings);
  return (
    <View style={{gap: space.sm}}>
      <Ring
        progress={result.score / 100}
        label={String(result.score)}
        caption={result.note}
        color={result.score >= 70 ? ctx.palette.sage : result.score >= 40 ? ctx.palette.gold : ctx.palette.accent}
        size={68}
      />
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
        {result.parts.map(part => (
          <Txt key={part.label} variant="micro" color="muted">
            {part.label} {part.value}/{part.weight}
          </Txt>
        ))}
      </View>
    </View>
  );
}

export function CalendarLoadWidget(ctx: WidgetContext): React.JSX.Element {
  const load = dayLoad(ctx.snapshot, ctx.settings);
  const average = averageLoad(ctx.snapshot, ctx.settings, 5);
  const slots = freeSlots(ctx.snapshot, ctx.settings, ctx.snapshot.todayKey, 30);
  return (
    <View style={{gap: 6}}>
      <Stat
        value={percent(load.ratio)}
        label="of workday booked"
        hint={`${minutesLabel(load.scheduledMinutes)} in ${load.meetingCount} events`}
        color={load.ratio > 0.9 ? ctx.palette.danger : ctx.palette.sage}
      />
      <View style={{height: 6, borderRadius: 3, backgroundColor: ctx.palette.surfaceAlt, overflow: 'hidden'}}>
        <View
          style={{
            width: `${Math.min(1, load.ratio) * 100}%`,
            height: 6,
            backgroundColor: load.ratio > 0.9 ? ctx.palette.danger : ctx.palette.sage,
          }}
        />
      </View>
      <Txt variant="micro" color="faint">
        Next 5 days avg {percent(average)} · {slots.length} free block{slots.length === 1 ? '' : 's'} today
      </Txt>
    </View>
  );
}

export function MoodCheckinWidget(ctx: WidgetContext): React.JSX.Element {
  const saveMood = useStore(state => state.saveMood);
  const mood = ctx.snapshot.mood;
  const [moodValue, setMoodValue] = useState(mood?.mood ?? 3);
  const [energy, setEnergy] = useState(mood?.energy ?? 3);
  const [saved, setSaved] = useState(false);
  return (
    <View style={{gap: 6}}>
      <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
        MOOD
      </Txt>
      <View style={{flexDirection: 'row', gap: 4}}>
        {[1, 2, 3, 4, 5].map(value => (
          <Pressable
            key={value}
            onPress={() => setMoodValue(value)}
            accessibilityRole="radio"
            accessibilityState={{selected: moodValue === value}}
            accessibilityLabel={`Mood ${value} of 5`}
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: moodValue >= value ? ctx.palette.gold : ctx.palette.surfaceAlt,
            }}>
            <Txt variant="micro" style={{color: moodValue >= value ? '#FFFFFF' : ctx.palette.faint}}>
              {value}
            </Txt>
          </Pressable>
        ))}
      </View>
      <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
        ENERGY
      </Txt>
      <View style={{flexDirection: 'row', gap: 4}}>
        {[1, 2, 3, 4, 5].map(value => (
          <Pressable
            key={value}
            onPress={() => setEnergy(value)}
            accessibilityRole="radio"
            accessibilityState={{selected: energy === value}}
            accessibilityLabel={`Energy ${value} of 5`}
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: energy >= value ? ctx.palette.sky : ctx.palette.surfaceAlt,
            }}>
            <Txt variant="micro" style={{color: energy >= value ? '#FFFFFF' : ctx.palette.faint}}>
              {value}
            </Txt>
          </Pressable>
        ))}
      </View>
      <Pressable
        onPress={() => {
          void saveMood(moodValue, energy).then(() => setSaved(true));
        }}
        accessibilityRole="button"
        accessibilityLabel="Save mood check-in">
        <Txt variant="micro" color={saved ? 'sage' : 'accent'} style={{fontWeight: '800'}}>
          {saved ? 'SAVED' : 'SAVE CHECK-IN'}
        </Txt>
      </Pressable>
    </View>
  );
}

export function ReminderInboxWidget(ctx: WidgetContext): React.JSX.Element {
  const dismiss = useStore(state => state.dismissReminder);
  const upcoming = ctx.snapshot.reminders
    .filter(reminder => reminder.triggerAt >= ctx.snapshot.now - 3_600_000)
    .slice(0, 5);
  if (upcoming.length === 0) {
    return <WidgetEmpty text="No pending reminders." actionLabel="Open settings" onAction={() => ctx.navigate('settings')} />;
  }
  return (
    <View style={{gap: 3}}>
      {upcoming.map(reminder => (
        <View key={reminder.id} style={{flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30}}>
          <View style={{flex: 1}}>
            <Txt variant="small" numberOfLines={1}>
              {reminder.title}
            </Txt>
            <Txt variant="micro" color="faint">
              {relativeDay(reminder.triggerAt, ctx.snapshot.now, ctx.settings.calendarTimeZone)} ·{' '}
              {formatTime(reminder.triggerAt, ctx.settings.calendarTimeZone, ctx.settings.clock24h)}
            </Txt>
          </View>
          <Pressable
            onPress={() => void dismiss(reminder.id)}
            accessibilityRole="button"
            accessibilityLabel={`Dismiss reminder ${reminder.title}`}
            hitSlop={8}>
            <Txt variant="small" color="faint">
              ✕
            </Txt>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

export function QuickCaptureWidget(ctx: WidgetContext): React.JSX.Element {
  const palette = useTheme();
  const saveNote = useStore(state => state.saveNote);
  const saveTask = useStore(state => state.saveTask);
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const submit = async (mode: 'note' | 'task'): Promise<void> => {
    const trimmed = value.trim();
    if (trimmed === '') {
      return;
    }
    if (mode === 'note') {
      await saveNote({title: '', body: trimmed, notebookId: null, tags: [], pinned: false});
      setStatus('Note saved');
    } else {
      await saveTask({title: trimmed, dueAt: ctx.snapshot.now, dueHasTime: false});
      setStatus('Task added');
    }
    setValue('');
  };
  return (
    <View style={{gap: 5}}>
      <TextInput
        value={value}
        onChangeText={text => {
          setValue(text);
          setStatus(null);
        }}
        placeholder="Capture anything…"
        placeholderTextColor={palette.faint}
        accessibilityLabel="Quick capture text"
        style={{
          borderWidth: 1,
          borderColor: palette.line,
          backgroundColor: palette.surfaceAlt,
          color: palette.ink,
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 8,
          fontSize: 14,
        }}
      />
      <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
        <Txt variant="micro" color={status ? 'sage' : 'faint'}>
          {status ?? 'Note or task'}
        </Txt>
        <View style={{flexDirection: 'row', gap: 8}}>
          <Pressable onPress={() => void submit('note')} accessibilityRole="button" accessibilityLabel="Save as note">
            <Txt variant="micro" color="accent" style={{fontWeight: '800'}}>
              NOTE
            </Txt>
          </Pressable>
          <Pressable onPress={() => void submit('task')} accessibilityRole="button" accessibilityLabel="Save as task">
            <Txt variant="micro" color="accent" style={{fontWeight: '800'}}>
              TASK
            </Txt>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const FAVORITE_TARGETS: Record<string, string> = {
  new_event: 'event',
  new_task: 'task',
  new_note: 'note',
  assistant: 'assistant',
  habits: 'habits',
  focus: 'focus',
  plan: 'plan',
  insights: 'insights',
};

export function FavoriteActionsWidget(ctx: WidgetContext): React.JSX.Element {
  const favorites = ctx.snapshot.favorites;
  if (favorites.length === 0) {
    return <WidgetEmpty text="No favourite actions." />;
  }
  return (
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
      {favorites.slice(0, 6).map(favorite => (
        <Pressable
          key={favorite.id}
          onPress={() => {
            const target = FAVORITE_TARGETS[String(favorite.action)] ?? 'dashboard';
            if (target === 'assistant') {
              ctx.openAssistant();
            } else {
              ctx.navigate(target as never);
            }
          }}
          accessibilityRole="button"
          accessibilityLabel={favorite.label}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: ctx.palette.line,
            backgroundColor: ctx.palette.surfaceAlt,
            minHeight: 34,
            justifyContent: 'center',
          }}>
          <Txt variant="micro" style={{fontWeight: '700'}}>
            {favorite.label}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
}

