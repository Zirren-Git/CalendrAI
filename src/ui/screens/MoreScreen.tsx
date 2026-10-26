/** More: the secondary surfaces, plus a plain-language privacy summary. */
import React from 'react';
import {Pressable, ScrollView, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {Card, Divider, Row, SectionHeader, Txt} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import type {WidgetTarget} from '../widgets/types';
import type {AppNavigation} from '../navigation';

type LinkTarget = Exclude<WidgetTarget, 'event' | 'task' | 'note' | 'dashboard' | 'assistant'> | 'models';

const LINKS: {target: LinkTarget; label: string; description: string; glyph: string}[] = [
  {target: 'habits', label: 'Habits & routines', description: 'Check-ins, streaks and routines', glyph: '◍'},
  {target: 'focus', label: 'Focus', description: 'Pomodoro, deep work and time tracking', glyph: '◔'},
  {target: 'plan', label: 'Plan', description: 'Goals, routines and the weekly review', glyph: '◇'},
  {target: 'insights', label: 'Insights', description: 'Scores, load and weekly summary', glyph: '◈'},
  {target: 'search', label: 'Search', description: 'Search events, tasks and notes', glyph: '⌕'},
  {target: 'models', label: 'AI models', description: 'Speech and optional language models', glyph: '⬡'},
  {target: 'settings', label: 'Settings', description: 'Calendar, reminders, backup and privacy', glyph: '⚙'},
];

export function MoreScreen({
  onNavigate,
}: {
  onNavigate: (target: WidgetTarget, params?: Record<string, unknown>) => void;
}): React.JSX.Element {
  const navigate = (target: LinkTarget): void => {
    if (target === 'models') {
      navigation.navigate('Models');
      return;
    }
    onNavigate(target);
  };
  const palette = useTheme();
  const navigation = useNavigation<AppNavigation>();
  const snapshot = useStore(state => state.snapshot);
  return (
    <ScrollView style={{flex: 1}} contentContainerStyle={{padding: space.lg, paddingBottom: 120}}>
      <Txt variant="h1">More</Txt>
      <Txt variant="small" color="muted">
        Everything else, still local.
      </Txt>

      <SectionHeader title="Workspace" />
      {LINKS.map(link => (
        <Card
          key={link.target}
          style={{marginBottom: 8}}
          onPress={() => navigate(link.target)}
          accessibilityLabel={link.label}>
          <Row gap={12}>
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: palette.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Txt variant="small" color="accent">
                {link.glyph}
              </Txt>
            </View>
            <View style={{flex: 1}}>
              <Txt variant="body" style={{fontWeight: '600'}}>
                {link.label}
              </Txt>
              <Txt variant="micro" color="muted">
                {link.description}
              </Txt>
            </View>
            <Txt variant="small" color="faint">
              ›
            </Txt>
          </Row>
        </Card>
      ))}

      <SectionHeader title="At a glance" />
      <Card>
        <Row align="space-between"><Txt variant="small" color="muted">Events cached</Txt><Txt variant="small">{snapshot?.occurrences.length ?? 0}</Txt></Row>
        <Divider style={{marginVertical: 6}} />
        <Row align="space-between"><Txt variant="small" color="muted">Open tasks</Txt><Txt variant="small">{snapshot?.tasks.filter(task => !task.completedAt).length ?? 0}</Txt></Row>
        <Divider style={{marginVertical: 6}} />
        <Row align="space-between"><Txt variant="small" color="muted">Habits</Txt><Txt variant="small">{snapshot?.habits.filter(habit => !habit.archived).length ?? 0}</Txt></Row>
        <Divider style={{marginVertical: 6}} />
        <Row align="space-between"><Txt variant="small" color="muted">Pending reminders</Txt><Txt variant="small">{snapshot?.reminders.length ?? 0}</Txt></Row>
      </Card>

      <SectionHeader title="Privacy" />
      <Card>
        <Txt variant="small" color="muted">
          Dayloom keeps your calendar, tasks, notes, recordings and prompts on this device. There is no account,
          no sync and no analytics. The only network use is an optional model download you start yourself.
        </Txt>
        <Pressable
          onPress={() => {
            navigation.navigate('Settings');
          }}
          accessibilityRole="button"
          accessibilityLabel="Open privacy and data settings"
          style={{marginTop: 8}}>
          <Txt variant="small" color="accent" style={{fontWeight: '700'}}>
            Review data controls
          </Txt>
        </Pressable>
      </Card>
    </ScrollView>
  );
}
