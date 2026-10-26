/**
 * Assistant: text or push-to-talk in, a validated plan out.
 *
 * The plan is shown before anything is written unless the user opted into
 * auto-executing safe actions in Settings. Destructive actions always ask.
 */
import React, {useState} from 'react';
import {Pressable, ScrollView, TextInput, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {AppBar, Card, GhostButton, PrimaryButton, Row, Txt} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {describeInstant} from '../../agent/planner';
import type {AgentAction} from '../../agent/types';

const SUGGESTIONS = [
  'Lunch with Ana tomorrow at 12:30',
  'Add task: send the deck by Friday',
  'What does my day look like?',
  'When am I free for an hour?',
  'Start a 25 minute pomodoro',
  'Note: idea for the launch',
];

export function AssistantScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const palette = useTheme();
  const [text, setText] = useState('');
  const planText = useStore(state => state.planText);
  const confirmPlan = useStore(state => state.confirmPlan);
  const clearPlan = useStore(state => state.clearPlan);
  const startVoice = useStore(state => state.startVoice);
  const stopVoice = useStore(state => state.stopVoice);
  const plan = useStore(state => state.lastPlan);
  const outcome = useStore(state => state.lastOutcome);
  const transcript = useStore(state => state.transcript);
  const recording = useStore(state => state.recording);
  const busy = useStore(state => state.busy);
  const llmModelId = useStore(state => state.llmModelId);
  const settings = useStore(state => state.settings);
  const undoLast = useStore(state => state.undoLast);

  const run = (): void => {
    const command = text.trim();
    if (command === '') {
      return;
    }
    setText('');
    void planText(command);
  };

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <AppBar title="Assistant" subtitle="On-device · no network" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{padding: space.lg, paddingBottom: 24}} keyboardShouldPersistTaps="handled">
        <Card style={{marginBottom: space.md}}>
          <Txt variant="small" color="muted">
            {llmModelId
              ? 'Understands commands with your installed local model, and falls back to the built-in parser.'
              : 'Uses the built-in on-device parser. You can add an optional language model under AI models — it is not required for any command.'}
          </Txt>
          <Txt variant="micro" color="faint" style={{marginTop: 6}}>
            {settings.autoExecuteSafeCommands
              ? 'Safe actions run immediately; destructive actions still ask.'
              : 'Every action is shown for confirmation before it runs.'}
          </Txt>
        </Card>

        {recording ? (
          <Card accentColor={palette.danger} style={{marginBottom: space.md}}>
            <Txt variant="h3" color="danger">
              Listening…
            </Txt>
            <Txt variant="small" color="muted">
              Speak your command, then tap stop. Audio is transcribed on this device and deleted afterwards.
            </Txt>
          </Card>
        ) : null}

        {transcript ? (
          <Card style={{marginBottom: space.md}}>
            <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
              Heard
            </Txt>
            <Txt variant="body">“{transcript}”</Txt>
          </Card>
        ) : null}

        {busy ? (
          <Txt variant="small" color="muted" style={{marginBottom: space.md}}>
            {busy === 'Transcribing' ? 'Transcribing on device…' : 'Working out the plan…'}
          </Txt>
        ) : null}

        {plan ? (
          <PlanCard
            plan={plan}
            onCancel={clearPlan}
            onConfirm={() => {
              if (plan.planning.kind === 'plan') {
                void confirmPlan(plan.planning.plan);
              }
            }}
          />
        ) : null}

        {outcome ? (
          <Card style={{marginBottom: space.md}} accentColor={outcome.allSucceeded ? palette.sage : palette.danger}>
            <Txt variant="h3">{outcome.allSucceeded ? 'Done' : 'Partly done'}</Txt>
            <Txt variant="small" color="muted" style={{marginBottom: 6}}>
              {outcome.succeeded} succeeded · {outcome.failed} failed
            </Txt>
            {outcome.results.map(result => (
              <View key={result.actionId} style={{marginBottom: 4}}>
                <Txt variant="small" color={result.ok ? 'ink' : 'danger'}>
                  {result.ok ? '✓' : '✕'} {result.message}
                </Txt>
                {result.answer ? (
                  <Txt variant="small" color="muted" style={{marginLeft: 14}}>
                    {result.answer}
                  </Txt>
                ) : null}
              </View>
            ))}
            {outcome.undoToken ? (
              <View style={{marginTop: 8}}>
                <GhostButton
                  label="Undo this change"
                  onPress={() => {
                    void undoLast();
                  }}
                />
              </View>
            ) : null}
          </Card>
        ) : null}

        <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
          Try
        </Txt>
        <Row gap={6} style={{flexWrap: 'wrap'}}>
          {SUGGESTIONS.map(suggestion => (
            <Pressable
              key={suggestion}
              onPress={() => {
                setText(suggestion);
                void planText(suggestion);
              }}
              accessibilityRole="button"
              accessibilityLabel={suggestion}
              style={{
                borderWidth: 1,
                borderColor: palette.line,
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 6,
                minHeight: 34,
                justifyContent: 'center',
              }}>
              <Txt variant="micro" color="muted">
                {suggestion}
              </Txt>
            </Pressable>
          ))}
        </Row>
      </ScrollView>

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: palette.line,
          padding: space.md,
          backgroundColor: palette.surface,
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: space.sm,
        }}>
        <Pressable
          onPress={() => {
            if (recording) {
              void stopVoice();
            } else {
              clearPlan();
              void startVoice();
            }
          }}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Start push-to-talk'}
          accessibilityState={{busy: recording}}
          style={{
            width: 46,
            height: 46,
            borderRadius: 23,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: recording ? palette.danger : palette.surfaceAlt,
            borderWidth: 1,
            borderColor: recording ? palette.danger : palette.line,
          }}>
          <Txt variant="h3" style={{color: recording ? '#FFFFFF' : palette.accent}}>
            {recording ? '■' : '◉'}
          </Txt>
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={run}
          placeholder="Create, complete, ask…"
          placeholderTextColor={palette.faint}
          accessibilityLabel="Command text"
          returnKeyType="send"
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: palette.line,
            borderRadius: 22,
            paddingHorizontal: 14,
            paddingVertical: 10,
            color: palette.ink,
            backgroundColor: palette.surfaceAlt,
            minHeight: 46,
            maxHeight: 120,
            fontSize: 15,
          }}
        />
        <PrimaryButton label="Send" compact onPress={run} />
      </View>
    </View>
  );
}

function PlanCard({
  plan,
  onCancel,
  onConfirm,
}: {
  plan: NonNullable<ReturnType<typeof useStore.getState>['lastPlan']>;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const palette = useTheme();
  const settings = useStore(state => state.settings);
  const interpretation = plan.planning.interpretation;

  if (plan.planning.kind === 'unknown') {
    return (
      <Card style={{marginBottom: space.md}}>
        <Txt variant="small">{plan.planning.message}</Txt>
        <Txt variant="micro" color="faint" style={{marginTop: 6}}>
          Try naming an action, a title and a time — for example “Add task: call Sam tomorrow at 9”.
        </Txt>
      </Card>
    );
  }

  if (plan.planning.kind === 'clarify') {
    return (
      <Card style={{marginBottom: space.md}} accentColor={palette.gold}>
        <Txt variant="micro" color="gold" style={{textTransform: 'uppercase'}}>
          Need one detail
        </Txt>
        <Txt variant="body" style={{marginBottom: 8}}>
          {plan.planning.question}
        </Txt>
        <GhostButton label="Dismiss" onPress={onCancel} tone="muted" />
      </Card>
    );
  }

  const actionPlan = plan.planning.plan;
  const needsConfirm = actionPlan.actions.some(action => action.requiresConfirmation);

  return (
    <Card style={{marginBottom: space.md}} accentColor={needsConfirm ? palette.gold : palette.sage}>
      <Row align="space-between">
        <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
          {plan.usedLlm ? 'Planned with local model' : 'Planned on device'}
        </Txt>
        <Txt variant="micro" color="faint">
          {Math.round(actionPlan.confidence * 100)}% confident
        </Txt>
      </Row>
      <Txt variant="body" style={{marginVertical: 6}}>
        {actionPlan.interpretation}
      </Txt>
      {actionPlan.actions.map(entry => (
        <View key={entry.id} style={{marginBottom: 6}}>
          <Txt variant="small" style={{fontWeight: '600'}}>
            {entry.requiresConfirmation ? '⚠︎ ' : '• '}
            {entry.summary}
          </Txt>
          <Txt variant="micro" color="faint">
            {describeAction(entry.action, settings.calendarTimeZone, settings.clock24h)}
          </Txt>
        </View>
      ))}
      {interpretation.ambiguity ? (
        <Txt variant="small" color="danger" style={{marginBottom: 6}}>
          {interpretation.ambiguity}
        </Txt>
      ) : null}
      <Row gap={8} style={{marginTop: 4}}>
        <PrimaryButton
          label={needsConfirm ? 'Confirm and run' : 'Run'}
          compact
          onPress={onConfirm}
          tone={needsConfirm ? 'accent' : 'ink'}
        />
        <GhostButton label="Cancel" onPress={onCancel} tone="muted" />
      </Row>
    </Card>
  );
}

function describeAction(action: AgentAction, timeZone: string, clock24h: boolean): string {
  switch (action.type) {
    case 'create_event':
      return `${describeInstant(action.start, timeZone, clock24h)} → ${describeInstant(action.end, timeZone, clock24h)}${action.recurrence ? ' · repeats' : ''}`;
    case 'update_event':
      return `event ${action.eventId}`;
    case 'delete_event':
      return `event ${action.eventId} (${action.scope})`;
    case 'create_task':
      return action.dueAt ? `due ${describeInstant(action.dueAt, timeZone, clock24h)}` : 'no due date';
    case 'update_task':
    case 'complete_task':
    case 'delete_task':
      return `task ${action.taskId}`;
    case 'create_note':
      return 'local note';
    case 'set_reminder':
      return describeInstant(action.triggerAt, timeZone, clock24h);
    case 'start_timer':
    case 'start_pomodoro':
      return `${action.minutes} minutes · ${action.label}`;
    case 'log_habit':
      return `${action.habitName ?? action.habitId ?? 'habit'} · ${action.date}`;
    case 'query_schedule':
      return `${describeInstant(action.rangeStart, timeZone, clock24h)} → ${describeInstant(action.rangeEnd, timeZone, clock24h)}`;
    case 'query_tasks':
      return `${action.filter} tasks`;
    case 'find_free_time':
      return `${action.minMinutes} minutes on ${describeInstant(action.date, timeZone, clock24h)}`;
    case 'navigate':
      return `open ${action.screen}`;
    default:
      return '';
  }
}
