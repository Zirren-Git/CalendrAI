/** Plan: goals, routines and the weekly review. */
import React, {useEffect, useState} from 'react';
import {ScrollView, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {AppBar, Card, Field, GhostButton, PrimaryButton, ProgressBar, Row, SectionHeader, Txt} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {Segmented} from '../forms';
import {minutesLabel, percent} from '../format';
import {weekSummary} from '../widgets/data';

type Tab = 'goals' | 'routines' | 'review';

export function PlanScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const palette = useTheme();
  const snapshot = useStore(state => state.snapshot);
  const settings = useStore(state => state.settings);
  const addGoal = useStore(state => state.addGoal);
  const bumpGoal = useStore(state => state.bumpGoal);
  const saveReflection = useStore(state => state.saveReflection);
  const setRoutineEnabled = useStore(state => state.setRoutineEnabled);
  const [tab, setTab] = useState<Tab>('goals');
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('10');
  const [unit, setUnit] = useState('sessions');
  const [wins, setWins] = useState('');
  const [blockers, setBlockers] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (snapshot?.reflection) {
      setWins(snapshot.reflection.wins);
      setBlockers(snapshot.reflection.blockers);
      setNextSteps(snapshot.reflection.nextSteps);
    }
  }, [snapshot?.reflection]);

  if (!snapshot) {
    return <View style={{flex: 1, backgroundColor: palette.bg}} />;
  }

  const summary = weekSummary(snapshot, settings);

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <AppBar title="Plan" subtitle="Goals, routines and review" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{padding: space.lg, paddingBottom: 48}} keyboardShouldPersistTaps="handled">
        <Segmented
          label="Plan sections"
          value={tab}
          options={[
            {value: 'goals', label: 'Goals'},
            {value: 'routines', label: 'Routines'},
            {value: 'review', label: 'Weekly review'},
          ]}
          onChange={setTab}
        />

        {tab === 'goals' ? (
          <View style={{marginTop: space.md}}>
            <SectionHeader title="Active goals" hint={`${snapshot.goals.filter(goal => goal.status === 'active').length} in progress`} />
            {snapshot.goals.length === 0 ? (
              <Txt variant="small" color="faint">
                No goals yet. Add a measurable target below.
              </Txt>
            ) : (
              snapshot.goals.map(goal => {
                const ratio = goal.target === 0 ? 0 : goal.current / goal.target;
                return (
                  <Card key={goal.id} style={{marginBottom: 8}}>
                    <Row align="space-between">
                      <Txt variant="h3" style={{flex: 1}} numberOfLines={2}>
                        {goal.title}
                      </Txt>
                      <Txt variant="micro" color={goal.status === 'done' ? 'sage' : 'muted'}>
                        {goal.status.toUpperCase()}
                      </Txt>
                    </Row>
                    <View style={{marginVertical: 6}}>
                      <ProgressBar value={ratio} color={palette.plum} label={`${goal.title} progress`} />
                    </View>
                    <Row align="space-between">
                      <Txt variant="micro" color="muted">
                        {goal.current} / {goal.target} {goal.metricUnit} · {percent(ratio)}
                      </Txt>
                      <Row gap={8}>
                        <GhostButton label="+1" onPress={() => void bumpGoal(goal, 1)} />
                        <GhostButton label="+5" onPress={() => void bumpGoal(goal, 5)} />
                      </Row>
                    </Row>
                  </Card>
                );
              })
            )}

            <SectionHeader title="New goal" />
            <Field label="Title" value={title} onChangeText={setTitle} placeholder="Run a half marathon" />
            <Row gap={8}>
              <View style={{flex: 1}}>
                <Field label="Target" value={target} onChangeText={setTarget} keyboardType="number-pad" />
              </View>
              <View style={{flex: 1}}>
                <Field label="Unit" value={unit} onChangeText={setUnit} placeholder="km" />
              </View>
            </Row>
            <PrimaryButton
              label="Add goal"
              onPress={() => {
                const parsed = Number(target);
                if (!title.trim() || !Number.isFinite(parsed) || parsed <= 0) {
                  return;
                }
                void addGoal(title.trim(), parsed, unit.trim()).then(() => {
                  setTitle('');
                  setTarget('10');
                });
              }}
            />
          </View>
        ) : null}

        {tab === 'routines' ? (
          <View style={{marginTop: space.md}}>
            {snapshot.routines.map(routine => (
              <Card key={routine.id} style={{marginBottom: 10}}>
                <Row align="space-between">
                  <View style={{flex: 1}}>
                    <Txt variant="h3">{routine.name}</Txt>
                    <Txt variant="micro" color="muted">
                      {routine.items.length} steps · {routine.kind}
                    </Txt>
                  </View>
                  <GhostButton
                    label={routine.enabled ? 'On' : 'Off'}
                    tone={routine.enabled ? 'accent' : 'muted'}
                    onPress={() => void setRoutineEnabled(routine.id, !routine.enabled)}
                  />
                </Row>
                {routine.items.map(item => (
                  <Txt key={item} variant="small" color="muted" style={{marginTop: 4}}>
                    · {item}
                  </Txt>
                ))}
                <Txt variant="micro" color="faint" style={{marginTop: 6}}>
                  Check items off from the Habits screen or the dashboard widget.
                </Txt>
              </Card>
            ))}
          </View>
        ) : null}

        {tab === 'review' ? (
          <View style={{marginTop: space.md}}>
            <SectionHeader title="This week" />
            <Card style={{marginBottom: space.md}}>
              <Row align="space-between"><Txt variant="small" color="muted">Tasks completed</Txt><Txt variant="small">{summary.tasksCompleted}</Txt></Row>
              <Row align="space-between" style={{marginTop: 4}}><Txt variant="small" color="muted">Focus time</Txt><Txt variant="small">{minutesLabel(Math.round(summary.focusMinutes))}</Txt></Row>
              <Row align="space-between" style={{marginTop: 4}}><Txt variant="small" color="muted">Habit rate</Txt><Txt variant="small">{percent(summary.habitRate)}</Txt></Row>
              <Row align="space-between" style={{marginTop: 4}}><Txt variant="small" color="muted">Average booked</Txt><Txt variant="small">{minutesLabel(summary.averageScheduledMinutes)}/day</Txt></Row>
            </Card>
            <Field label="Wins" value={wins} onChangeText={setWins} placeholder="What went well?" multiline />
            <Field label="Blockers" value={blockers} onChangeText={setBlockers} placeholder="What got in the way?" multiline />
            <Field label="Next steps" value={nextSteps} onChangeText={setNextSteps} placeholder="What changes next week?" multiline />
            <PrimaryButton
              label={saved ? 'Saved' : 'Save review'}
              onPress={() => {
                void saveReflection({wins, blockers, nextSteps}).then(() => setSaved(true));
              }}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
