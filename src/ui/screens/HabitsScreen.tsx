/** Habits: check-ins, streaks, schedules and routines. */
import React, {useState} from 'react';
import {Alert, Pressable, ScrollView, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {AppBar, Card, Chip, Field, GhostButton, PrimaryButton, Row, SectionHeader, Sheet, Txt} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {habitLoggedOn, habitProgress, habitsToday, weekKeys} from '../widgets/data';
import {weekdayOfDateKey} from '../../domain/time';

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function HabitsScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const palette = useTheme();
  const snapshot = useStore(state => state.snapshot);
  const settings = useStore(state => state.settings);
  const toggleHabit = useStore(state => state.toggleHabit);
  const addHabit = useStore(state => state.addHabit);
  const archiveHabit = useStore(state => state.archiveHabit);
  const toggleRoutineItem = useStore(state => state.toggleRoutineItem);
  const setRoutineEnabled = useStore(state => state.setRoutineEnabled);
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('◆');
  const [schedule, setSchedule] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  if (!snapshot) {
    return <View style={{flex: 1, backgroundColor: palette.bg, padding: space.lg}}><Txt variant="small">Loading…</Txt></View>;
  }

  const active = snapshot.habits.filter(habit => !habit.archived);
  const todayHabits = habitsToday(snapshot);
  const keys = weekKeys(snapshot.todayKey, settings.weekStartsOn);

  const create = async (): Promise<void> => {
    if (name.trim() === '') {
      return;
    }
    await addHabit({name: name.trim(), emoji: emoji.trim() || '◆', schedule});
    setName('');
    setSchedule([0, 1, 2, 3, 4, 5, 6]);
    setSheet(false);
  };

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <AppBar
        title="Habits"
        subtitle={`${todayHabits.length} scheduled today`}
        onBack={() => navigation.goBack()}
        right={
          <Pressable onPress={() => setSheet(true)} accessibilityRole="button" accessibilityLabel="New habit" hitSlop={8}>
            <Txt variant="small" color="accent">
              New
            </Txt>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{padding: space.lg, paddingBottom: 48}}>
        {active.length === 0 ? (
          <Card style={{marginBottom: space.md}}>
            <Txt variant="h3">Start with one habit</Txt>
            <Txt variant="small" color="muted">
              Small and daily beats ambitious and abandoned. Check-ins and streaks are computed locally.
            </Txt>
            <View style={{marginTop: space.sm}}>
              <PrimaryButton label="Create a habit" onPress={() => setSheet(true)} />
            </View>
          </Card>
        ) : null}

        {active.map(habit => {
          const progress = habitProgress(snapshot, habit);
          const doneToday = habitLoggedOn(snapshot, habit.id, snapshot.todayKey);
          return (
            <Card key={habit.id} style={{marginBottom: 10}} accentColor={habit.color}>
              <Row align="space-between">
                <Row gap={8} style={{flex: 1}}>
                  <Txt variant="h3">{habit.emoji}</Txt>
                  <View style={{flex: 1}}>
                    <Txt variant="h3" numberOfLines={1}>
                      {habit.name}
                    </Txt>
                    <Txt variant="micro" color="muted">
                      {progress.streak} day streak · {progress.completedThisWeek}/{progress.targetPerWeek} this week
                    </Txt>
                  </View>
                </Row>
                <Pressable
                  onPress={() => void toggleHabit(habit.id, snapshot.todayKey)}
                  accessibilityRole="checkbox"
                  accessibilityState={{checked: doneToday}}
                  accessibilityLabel={`Check in ${habit.name}`}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: doneToday ? habit.color : 'transparent',
                    borderWidth: 1.5,
                    borderColor: doneToday ? habit.color : palette.line,
                  }}>
                  <Txt variant="small" style={{color: doneToday ? '#FFFFFF' : palette.muted, fontWeight: '800'}}>
                    ✓
                  </Txt>
                </Pressable>
              </Row>
              <Row gap={6} style={{marginTop: space.sm, justifyContent: 'space-between'}}>
                {keys.map(key => {
                  const logged = habitLoggedOn(snapshot, habit.id, key);
                  const scheduled = habit.schedule.includes(weekdayOfDateKey(key));
                  return (
                    <Pressable
                      key={key}
                      onPress={() => void toggleHabit(habit.id, key)}
                      accessibilityRole="checkbox"
                      accessibilityState={{checked: logged}}
                      accessibilityLabel={`${habit.name} on ${key}`}
                      style={{alignItems: 'center', gap: 3, flex: 1}}>
                      <Txt variant="micro" color="faint">
                        {WEEKDAY_LETTERS[weekdayOfDateKey(key)]}
                      </Txt>
                      <View
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: logged ? habit.color : palette.line,
                          backgroundColor: logged ? habit.color : scheduled ? palette.surfaceAlt : 'transparent',
                          opacity: scheduled ? 1 : 0.4,
                        }}
                      />
                    </Pressable>
                  );
                })}
              </Row>
              <Row align="space-between" style={{marginTop: space.sm}}>
                <Txt variant="micro" color="faint">
                  Best {progress.bestStreak} · score {Math.round(progress.score * 100)}%
                </Txt>
                <Pressable
                  onPress={() =>
                    Alert.alert('Archive habit', `Archive “${habit.name}”? Its history is kept.`, [
                      {text: 'Cancel', style: 'cancel'},
                      {text: 'Archive', style: 'destructive', onPress: () => void archiveHabit(habit.id)},
                    ])
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Archive ${habit.name}`}>
                  <Txt variant="micro" color="danger">
                    Archive
                  </Txt>
                </Pressable>
              </Row>
            </Card>
          );
        })}

        <SectionHeader title="Routines" hint="Morning and evening" />
        {snapshot.routines.map(routine => {
          const log = snapshot.routineLogs.find(entry => entry.routineId === routine.id);
          const completed = log?.completedItems ?? [];
          return (
            <Card key={routine.id} style={{marginBottom: 10}}>
              <Row align="space-between">
                <Txt variant="h3" style={{flex: 1}}>
                  {routine.name}
                </Txt>
                <GhostButton
                  label={routine.enabled ? 'Enabled' : 'Disabled'}
                  tone={routine.enabled ? 'accent' : 'muted'}
                  onPress={() => void setRoutineEnabled(routine.id, !routine.enabled)}
                />
              </Row>
              {routine.items.map(item => {
                const done = completed.includes(item);
                return (
                  <Pressable
                    key={item}
                    onPress={() => void toggleRoutineItem(routine.id, item, !done)}
                    accessibilityRole="checkbox"
                    accessibilityState={{checked: done}}
                    accessibilityLabel={item}
                    style={{flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5}}>
                    <View
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 8,
                        borderWidth: 1.5,
                        borderColor: done ? palette.sage : palette.line,
                        backgroundColor: done ? palette.sage : 'transparent',
                      }}
                    />
                    <Txt
                      variant="small"
                      style={{textDecorationLine: done ? 'line-through' : 'none', color: done ? palette.faint : palette.ink}}>
                      {item}
                    </Txt>
                  </Pressable>
                );
              })}
            </Card>
          );
        })}
      </ScrollView>

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="New habit">
        <Field label="Name" value={name} onChangeText={setName} placeholder="Read 10 pages" autoFocus />
        <Field label="Symbol" value={emoji} onChangeText={setEmoji} placeholder="◆" maxLength={2} />
        <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
          Scheduled days
        </Txt>
        <Row gap={6} style={{flexWrap: 'wrap', marginBottom: space.md}}>
          {[1, 2, 3, 4, 5, 6, 0].map(day => {
            const label = WEEKDAY_LETTERS[day]!;
            const activeDay = schedule.includes(day);
            return (
              <Chip
                key={day}
                label={label}
                active={activeDay}
                onPress={() =>
                  setSchedule(current =>
                    current.includes(day) ? current.filter(entry => entry !== day) : [...current, day],
                  )
                }
              />
            );
          })}
        </Row>
        <PrimaryButton label="Create habit" onPress={() => void create()} />
      </Sheet>
    </View>
  );
}
