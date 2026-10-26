/** Focus: pomodoro and deep-work timers plus time logging. */
import React, {useEffect, useState} from 'react';
import {Alert, ScrollView, View} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import {AppBar, Card, Chip, Field, GhostButton, PrimaryButton, ProgressBar, Row, SectionHeader, Txt} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {minutesLabel} from '../format';
import type {RootStackParamList} from '../navigation';

export function FocusScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'Focus'>>();
  const palette = useTheme();
  const snapshot = useStore(state => state.snapshot);
  const settings = useStore(state => state.settings);
  const beginFocus = useStore(state => state.beginFocus);
  const finishFocus = useStore(state => state.finishFocus);
  const logTime = useStore(state => state.logTime);
  const [minutes, setMinutes] = useState(settings.pomodoroMinutes);
  const [label, setLabel] = useState(route.params?.label ?? 'Focus');
  const [logLabel, setLogLabel] = useState('');
  const [logMinutes, setLogMinutes] = useState('30');
  const [tick, setTick] = useState(0);

  const active = snapshot?.activeFocus ?? null;
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => setTick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  void tick;

  const startedAt = active ? active.startedAt : null;
  const plannedMs = active ? active.plannedMinutes * 60_000 : minutes * 60_000;
  const elapsedMs = startedAt ? Date.now() - startedAt : 0;
  const remainingMs = Math.max(0, plannedMs - elapsedMs);
  const progress = plannedMs === 0 ? 0 : Math.min(1, elapsedMs / plannedMs);
  const remainingLabel = `${String(Math.floor(remainingMs / 60_000)).padStart(2, '0')}:${String(
    Math.floor((remainingMs % 60_000) / 1000),
  ).padStart(2, '0')}`;

  const sessions = snapshot?.focusToday ?? [];

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <AppBar title="Focus" subtitle={`${settings.calendarTimeZone.replace(/_/g, ' ')}`} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{padding: space.lg, paddingBottom: 48}} keyboardShouldPersistTaps="handled">
        <Card style={{alignItems: 'center', paddingVertical: space.xl}} accentColor={palette.gold}>
          <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
            {active ? (active.kind === 'focus' ? 'Focusing' : 'On a break') : 'Ready when you are'}
          </Txt>
          <Txt variant="display" style={{fontSize: 52, lineHeight: 60, color: palette.ink}}>
            {active ? remainingLabel : `${minutes}:00`}
          </Txt>
          <Txt variant="small" color="muted">
            {active ? active.label : label || 'Focus session'}
          </Txt>
          <View style={{width: '86%', marginTop: space.md}}>
            <ProgressBar value={active ? progress : 0} color={palette.gold} height={10} label="Session progress" />
          </View>
          {active ? (
            <Row gap={8} style={{marginTop: space.lg}}>
              <PrimaryButton
                label="Finish"
                onPress={() => {
                  void finishFocus(true);
                }}
              />
              <GhostButton
                label="Abandon"
                tone="danger"
                onPress={() => {
                  Alert.alert('Abandon session', 'This session will not count towards your focus time.', [
                    {text: 'Keep going', style: 'cancel'},
                    {text: 'Abandon', style: 'destructive', onPress: () => void finishFocus(false)},
                  ]);
                }}
              />
            </Row>
          ) : (
            <>
              <Row gap={6} style={{marginTop: space.md, flexWrap: 'wrap', justifyContent: 'center'}}>
                {[15, 25, 45, 50, 90].map(option => (
                  <Chip key={option} label={`${option}m`} active={minutes === option} onPress={() => setMinutes(option)} />
                ))}
              </Row>
              <View style={{width: '100%', marginTop: space.md}}>
                <Field label="Label" value={label} onChangeText={setLabel} placeholder="Deep work" />
              </View>
              <PrimaryButton
                label="Start focus"
                onPress={() => {
                  void beginFocus(minutes, label || 'Focus', 'focus', route.params?.taskId ?? null);
                }}
              />
              <View style={{marginTop: space.sm}}>
                <GhostButton
                  label={`Start ${settings.shortBreakMinutes} min break`}
                  tone="muted"
                  onPress={() => {
                    void beginFocus(settings.shortBreakMinutes, 'Break', 'break', null);
                  }}
                />
              </View>
            </>
          )}
        </Card>

        <SectionHeader title="Today" hint={minutesLabel(Math.round(sessions.filter(s => s.endedAt).reduce((sum, s) => sum + ((s.endedAt ?? s.startedAt) - s.startedAt) / 60_000, 0)))} />
        {sessions.length === 0 ? (
          <Txt variant="small" color="faint">
            No sessions yet today.
          </Txt>
        ) : (
          sessions.map(session => (
            <Row key={session.id} align="space-between" style={{paddingVertical: 6}}>
              <Txt variant="small" numberOfLines={1} style={{flex: 1}}>
                {session.label}
              </Txt>
              <Txt variant="micro" color={session.completed ? 'sage' : 'faint'}>
                {session.endedAt
                  ? `${Math.round(((session.endedAt - session.startedAt) / 60_000))}m ${session.completed ? '✓' : '· stopped'}`
                  : 'running'}
              </Txt>
            </Row>
          ))
        )}

        <SectionHeader title="Log time manually" />
        <Field label="What did you work on?" value={logLabel} onChangeText={setLogLabel} placeholder="Writing" />
        <Field
          label="Minutes"
          value={logMinutes}
          onChangeText={setLogMinutes}
          keyboardType="number-pad"
          placeholder="30"
          error={
            Number(logMinutes) > 0 && Number(logMinutes) <= 600 ? null : 'Enter 1 to 600 minutes'
          }
        />
        <GhostButton
          label="Add time entry"
          onPress={() => {
            const parsed = Number(logMinutes);
            if (!logLabel.trim() || !Number.isFinite(parsed) || parsed <= 0 || parsed > 600) {
              return;
            }
            void logTime(logLabel.trim(), parsed, 'manual').then(() => {
              setLogLabel('');
              setLogMinutes('30');
            });
          }}
        />
      </ScrollView>
    </View>
  );
}
