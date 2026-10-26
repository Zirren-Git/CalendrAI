/** Insights: today's transparency-first scores and this week's shape. */
import React from 'react';
import {ScrollView, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {AppBar, Card, ProgressBar, Row, SectionHeader, Txt} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {Bars, Stat} from '../widgets/primitives';
import {
  dayLoad,
  focusMinutesToday,
  habitScoreToday,
  productivity,
  weekKeys,
  weekSummary,
} from '../widgets/data';
import {minutesLabel, percent} from '../format';
import {localDateKey} from '../../domain/time';

export function InsightsScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const palette = useTheme();
  const snapshot = useStore(state => state.snapshot);
  const settings = useStore(state => state.settings);
  if (!snapshot) {
    return <View style={{flex: 1, backgroundColor: palette.bg}} />;
  }
  const score = productivity(snapshot, settings);
  const load = dayLoad(snapshot, settings);
  const summary = weekSummary(snapshot, settings);
  const keys = weekKeys(snapshot.todayKey, settings.weekStartsOn);
  const focusByDay = keys.map(key =>
    snapshot.recentSessions
      .filter(
        session =>
          session.kind === 'focus' &&
          session.endedAt &&
          localDateKey(session.startedAt, settings.calendarTimeZone) === key,
      )
      .reduce((sum, session) => sum + ((session.endedAt ?? 0) - session.startedAt) / 60_000, 0),
  );
  const completedByDay = keys.map(
    key =>
      snapshot.tasks.filter(
        task => task.completedAt && localDateKey(task.completedAt, settings.calendarTimeZone) === key,
      ).length,
  );
  const labels = keys.map(key => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${key}T12:00:00Z`).getUTCDay()] ?? '');
  const moods = snapshot.moods.slice(0, 14).reverse();

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <AppBar title="Insights" subtitle="All computed on device" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{padding: space.lg, paddingBottom: 48}}>
        <Card style={{marginBottom: space.md}}>
          <Row align="space-between">
            <Stat value={String(score.score)} label="productivity today" color={palette.accent} />
            <Txt variant="micro" color="faint" style={{maxWidth: 180, textAlign: 'right'}}>
              {score.note}
            </Txt>
          </Row>
          <View style={{marginTop: space.md, gap: 8}}>
            {score.parts.map(part => (
              <View key={part.label}>
                <Row align="space-between">
                  <Txt variant="micro" color="muted">
                    {part.label}
                  </Txt>
                  <Txt variant="micro" color="faint">
                    {part.value}/{part.weight}
                  </Txt>
                </Row>
                <ProgressBar value={part.value / part.weight} height={6} color={palette.sage} label={part.label} />
              </View>
            ))}
          </View>
        </Card>

        <Card style={{marginBottom: space.md}}>
          <Txt variant="h3">Today</Txt>
          <Row align="space-between" style={{marginTop: 6}}>
            <Txt variant="small" color="muted">Calendar booked</Txt>
            <Txt variant="small">{percent(load.ratio)}</Txt>
          </Row>
          <Row align="space-between" style={{marginTop: 4}}>
            <Txt variant="small" color="muted">Longest free block</Txt>
            <Txt variant="small">{minutesLabel(load.longestFreeBlockMinutes)}</Txt>
          </Row>
          <Row align="space-between" style={{marginTop: 4}}>
            <Txt variant="small" color="muted">Focus time</Txt>
            <Txt variant="small">{minutesLabel(Math.round(focusMinutesToday(snapshot)))}</Txt>
          </Row>
          <Row align="space-between" style={{marginTop: 4}}>
            <Txt variant="small" color="muted">Habit completion</Txt>
            <Txt variant="small">{percent(habitScoreToday(snapshot))}</Txt>
          </Row>
        </Card>

        <SectionHeader title="This week" hint={`${summary.tasksCompleted} tasks · ${minutesLabel(Math.round(summary.focusMinutes))} focus`} />
        <Card style={{marginBottom: space.md}}>
          <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
            Tasks completed
          </Txt>
          <Bars values={completedByDay} labels={labels} color={palette.sage} accessibilityLabel="Tasks completed per day" />
          <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginTop: space.md, marginBottom: 6}}>
            Focus minutes
          </Txt>
          <Bars values={focusByDay} labels={labels} color={palette.gold} accessibilityLabel="Focus minutes per day" />
          <Txt variant="micro" color="faint" style={{marginTop: space.sm}}>
            Habit rate {percent(summary.habitRate)} · average booked {minutesLabel(summary.averageScheduledMinutes)}/day
          </Txt>
        </Card>

        <SectionHeader title="Mood & energy" hint={`${moods.length} check-ins`} />
        <Card>
          {moods.length === 0 ? (
            <Txt variant="small" color="faint">
              Check in from the dashboard to see a trend here.
            </Txt>
          ) : (
            <Bars
              values={moods.map(mood => mood.mood)}
              labels={moods.map(mood => mood.date.slice(-2))}
              color={palette.plum}
              accessibilityLabel="Mood trend"
            />
          )}
        </Card>
      </ScrollView>
    </View>
  );
}
