/**
 * Settings: calendar preferences, reminders, privacy, and local import/export.
 * Nothing here talks to a network; imports and exports go through the Android
 * document picker so the user owns the file location.
 */
import React, {useState} from 'react';
import {Alert, PermissionsAndroid, Platform, ScrollView, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {AppBar, Card, Divider, Field, GhostButton, Row, SectionHeader, Txt, ToggleRow} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {isValidTimeZone} from '../../domain/time';
import {exportIcs, importIcs} from '../../domain/ics';
import {exportBackup, importBackup, summariseBackup, validateBackup} from '../../domain/backup';
import {createEvent, listAllEvents, addEventReminder} from '../../repos/events';
import {applyUndo, latestUndo} from '../../repos/system';
import {documents, reminders as reminderBridge, launcherWidgets} from '../../native/index';
import {formatTime} from '../../domain/time';
import {minutesLabel} from '../format';

export function SettingsScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const palette = useTheme();
  const db = useStore(state => state.db);
  const settings = useStore(state => state.settings);
  const snapshot = useStore(state => state.snapshot);
  const updateSetting = useStore(state => state.updateSetting);
  const refresh = useStore(state => state.refresh);
  const notify = useStore(state => state.notify);
  const [timezone, setTimezone] = useState(settings.calendarTimeZone);
  const [busy, setBusy] = useState<string | null>(null);

  const runExportBackup = async (): Promise<void> => {
    if (!db || !documents.available()) {
      notify({kind: 'error', message: 'File export is unavailable in this build.'});
      return;
    }
    setBusy('backup-export');
    try {
      const document = await exportBackup(db);
      const json = JSON.stringify(document, null, 2);
      const uri = await documents.module().pickExportTarget(`dayloom-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      if (!uri) {
        return;
      }
      await documents.module().writeTextFile(uri, json);
      notify({kind: 'success', message: 'Backup written to the location you chose.'});
    } catch (error) {
      notify({kind: 'error', message: error instanceof Error ? error.message : 'Export failed.'});
    } finally {
      setBusy(null);
    }
  };

  const runImportBackup = async (): Promise<void> => {
    if (!db || !documents.available()) {
      notify({kind: 'error', message: 'File import is unavailable in this build.'});
      return;
    }
    try {
      const uri = await documents.module().pickImportFile('application/json');
      if (!uri) {
        return;
      }
      const raw = await documents.module().readTextFile(uri);
      const document = validateBackup(JSON.parse(raw) as unknown);
      const summary = summariseBackup(document);
      Alert.alert(
        'Import backup',
        `${summary.totalRows} rows from ${new Date(summary.exportedAt).toLocaleDateString()}. Merge keeps existing records; replace deletes everything first.`,
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Merge',
            onPress: () => {
              void (async () => {
                const result = await importBackup(db, document, {mode: 'merge'});
                await refresh();
                notify({kind: 'success', message: `Merged ${result.totalInserted} rows.`});
              })();
            },
          },
          {
            text: 'Replace',
            style: 'destructive',
            onPress: () => {
              Alert.alert('Replace everything?', 'This deletes current data first. It cannot be undone.', [
                {text: 'Cancel', style: 'cancel'},
                {
                  text: 'Replace',
                  style: 'destructive',
                  onPress: () => {
                    void (async () => {
                      const result = await importBackup(db, document, {mode: 'replace'});
                      await refresh();
                      notify({kind: 'success', message: `Replaced with ${result.totalInserted} rows.`});
                    })();
                  },
                },
              ]);
            },
          },
        ],
      );
    } catch (error) {
      notify({kind: 'error', message: error instanceof Error ? error.message : 'That file is not a Dayloom backup.'});
    }
  };

  const runIcsExport = async (): Promise<void> => {
    if (!db || !documents.available()) {
      notify({kind: 'error', message: 'File export is unavailable in this build.'});
      return;
    }
    setBusy('ics-export');
    try {
      const events = await listAllEvents(db);
      const ics = exportIcs(events, {now: Date.now(), calendarName: 'Dayloom'});
      const uri = await documents.module().pickExportTarget('dayloom.ics', 'text/calendar');
      if (!uri) {
        return;
      }
      await documents.module().writeTextFile(uri, ics);
      notify({kind: 'success', message: `Exported ${events.length} events as ICS.`});
    } catch (error) {
      notify({kind: 'error', message: error instanceof Error ? error.message : 'ICS export failed.'});
    } finally {
      setBusy(null);
    }
  };

  const runIcsImport = async (): Promise<void> => {
    if (!db || !documents.available()) {
      notify({kind: 'error', message: 'File import is unavailable in this build.'});
      return;
    }
    setBusy('ics-import');
    try {
      const uri = await documents.module().pickImportFile('text/calendar');
      if (!uri) {
        return;
      }
      const raw = await documents.module().readTextFile(uri);
      const result = importIcs(raw, settings.calendarTimeZone);
      for (const event of result.events) {
        const created = await createEvent(db, event);
        if (created.start - 10 * 60_000 > Date.now()) {
          await addEventReminder(db, created.id, created.start - 10 * 60_000, created.title, 10);
        }
      }
      await refresh();
      notify({
        kind: result.events.length > 0 ? 'success' : 'info',
        message: `Imported ${result.events.length} events${result.skipped > 0 ? `, skipped ${result.skipped}` : ''}.`,
      });
    } catch (error) {
      notify({kind: 'error', message: error instanceof Error ? error.message : 'ICS import failed.'});
    } finally {
      setBusy(null);
    }
  };

  const requestNotificationPermission = async (): Promise<void> => {
    if (!reminderBridge.available()) {
      notify({kind: 'error', message: 'Notifications are unavailable in this build.'});
      return;
    }
    let granted = false;
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
        title: 'Allow reminders',
        message: 'Dayloom posts reminders you created locally. There are no marketing or background notifications.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      });
      granted = result === PermissionsAndroid.RESULTS.GRANTED;
    } else {
      granted = await reminderBridge.module().requestPermission();
    }
    notify({
      kind: granted ? 'success' : 'info',
      message: granted ? 'Notifications allowed.' : 'Notifications were not allowed; reminders stay in the in-app inbox.',
    });
  };

  const exactAlarmStatus = reminderBridge.available()
    ? reminderBridge.module().canScheduleExactAlarms()
    : Promise.resolve(false);

  const modelSummary = snapshot?.modelStates ?? [];
  const installed = modelSummary.filter(state => state.status === 'installed').length;

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <AppBar title="Settings" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{padding: space.lg, paddingBottom: 64}}>
        <SectionHeader title="Appearance" />
        <Row gap={6} style={{marginBottom: space.md, flexWrap: 'wrap'}}>
          {(['system', 'light', 'dark'] as const).map(mode => (
            <GhostButton
              key={mode}
              label={mode[0]!.toUpperCase() + mode.slice(1)}
              onPress={() => void updateSetting('theme', mode)}
              tone={settings.theme === mode ? 'accent' : 'muted'}
            />
          ))}
        </Row>
        <ToggleRow
          label="24-hour clock"
          value={settings.clock24h}
          onPress={() => void updateSetting('clock24h', !settings.clock24h)}
        />
        <ToggleRow
          label="Week starts on Monday"
          value={settings.weekStartsOn === 1}
          onPress={() => void updateSetting('weekStartsOn', settings.weekStartsOn === 1 ? 0 : 1)}
        />

        <SectionHeader title="Calendar" hint={`Timezone: ${settings.calendarTimeZone}`} />
        <Field
          label="Calendar timezone"
          value={timezone}
          onChangeText={setTimezone}
          autoCapitalize="none"
          hint="IANA name, e.g. Europe/Berlin"
          error={isValidTimeZone(timezone) ? null : 'Unknown timezone'}
        />
        <GhostButton
          label="Save timezone"
          onPress={() => {
            if (!isValidTimeZone(timezone)) {
              notify({kind: 'error', message: 'That is not a valid IANA timezone.'});
              return;
            }
            void updateSetting('calendarTimeZone', timezone).then(() =>
              notify({kind: 'success', message: 'Calendar timezone updated.'}),
            );
          }}
        />
        <Row gap={8} style={{marginTop: space.md, flexWrap: 'wrap'}}>
          <GhostButton
            label={`Workday ${formatTime(dayMinute(settings.workdayStart), settings.calendarTimeZone, settings.clock24h)}`}
            onPress={() => void updateSetting('workdayStart', shiftMinute(settings.workdayStart, 60))}
          />
          <GhostButton
            label={`to ${formatTime(dayMinute(settings.workdayEnd), settings.calendarTimeZone, settings.clock24h)}`}
            onPress={() => void updateSetting('workdayEnd', shiftMinute(settings.workdayEnd, 60))}
          />
          <GhostButton
            label={`Default ${minutesLabel(settings.defaultEventMinutes)}`}
            onPress={() => void updateSetting('defaultEventMinutes', settings.defaultEventMinutes >= 120 ? 15 : settings.defaultEventMinutes + 15)}
          />
        </Row>

        <SectionHeader title="Focus" />
        <Row gap={8} style={{flexWrap: 'wrap'}}>
          <GhostButton
            label={`Pomodoro ${settings.pomodoroMinutes}m`}
            onPress={() => void updateSetting('pomodoroMinutes', cycle(settings.pomodoroMinutes, [15, 20, 25, 30, 45, 50]))}
          />
          <GhostButton
            label={`Short break ${settings.shortBreakMinutes}m`}
            onPress={() => void updateSetting('shortBreakMinutes', cycle(settings.shortBreakMinutes, [3, 5, 10]))}
          />
          <GhostButton
            label={`Long break ${settings.longBreakMinutes}m`}
            onPress={() => void updateSetting('longBreakMinutes', cycle(settings.longBreakMinutes, [10, 15, 20, 30]))}
          />
        </Row>

        <SectionHeader title="Reminders & notifications" />
        <ToggleRow
          label="Reminder notifications"
          description="Reminders stay in the in-app inbox when notifications are off or not permitted."
          value={settings.notificationsEnabled}
          onPress={() => void updateSetting('notificationsEnabled', !settings.notificationsEnabled)}
        />
        <Row gap={8} style={{marginTop: space.sm, flexWrap: 'wrap'}}>
          <GhostButton label="Allow notifications" onPress={() => void requestNotificationPermission()} />
          <GhostButton
            label="Exact alarm status"
            onPress={() => {
              void exactAlarmStatus.then(canExact =>
                notify({
                  kind: 'info',
                  message: canExact
                    ? 'Exact alarms are allowed; reminders fire on time.'
                    : 'Exact alarms are not allowed. Reminders may arrive a few minutes late.',
                }),
              );
            }}
          />
          <GhostButton
            label="Refresh launcher widgets"
            onPress={() => {
              void launcherWidgets.refresh().then(() => notify({kind: 'success', message: 'Launcher widgets refreshed.'}));
            }}
          />
        </Row>

        <SectionHeader title="Assistant & privacy" />
        <ToggleRow
          label="Run safe actions without confirmation"
          description="Deletes and ambiguous commands always ask."
          value={settings.autoExecuteSafeCommands}
          onPress={() => void updateSetting('autoExecuteSafeCommands', !settings.autoExecuteSafeCommands)}
        />
        <ToggleRow
          label="Keep transcripts in the assistant log"
          description="Audio recordings are deleted after transcription either way."
          value={settings.retainTranscripts}
          onPress={() => void updateSetting('retainTranscripts', !settings.retainTranscripts)}
        />
        <ToggleRow
          label="Download models over Wi-Fi only"
          value={settings.wifiOnlyDownloads}
          onPress={() => void updateSetting('wifiOnlyDownloads', !settings.wifiOnlyDownloads)}
        />
        <Card style={{marginTop: space.md}}>
          <Txt variant="small" color="muted">
            Dayloom has no account, no sync and no analytics. Calendar, tasks, notes, habit history, prompts and
            transcripts stay in this app’s private storage. Model downloads are the only network use and are always
            started by you.
          </Txt>
          <Divider style={{marginVertical: 8}} />
          <Row align="space-between">
            <Txt variant="small" color="muted">
              AI models installed
            </Txt>
            <Txt variant="small">{installed}</Txt>
          </Row>
          <View style={{marginTop: 8}}>
            <GhostButton label="Manage AI models" onPress={() => navigation.navigate('Models' as never)} />
          </View>
        </Card>

        <SectionHeader title="Backup & export" />
        <Row gap={8} style={{flexWrap: 'wrap'}}>
          <GhostButton label={busy === 'backup-export' ? 'Exporting…' : 'Export backup'} onPress={() => void runExportBackup()} />
          <GhostButton label="Import backup" onPress={() => void runImportBackup()} />
          <GhostButton label={busy === 'ics-export' ? 'Exporting…' : 'Export calendar (.ics)'} onPress={() => void runIcsExport()} />
          <GhostButton label={busy === 'ics-import' ? 'Importing…' : 'Import calendar (.ics)'} onPress={() => void runIcsImport()} />
        </Row>
        <Txt variant="small" color="faint" style={{marginTop: 8}}>
          Backups include your local rows. Model files are never included and must be downloaded again on a new
          device.
        </Txt>

        <SectionHeader title="Diagnostics" />
        <Card>
          <Row align="space-between">
            <Txt variant="small" color="muted">Database</Txt>
            <Txt variant="small">SQLite · app-private</Txt>
          </Row>
          <Divider style={{marginVertical: 6}} />
          <Row align="space-between">
            <Txt variant="small" color="muted">Speech engine</Txt>
            <Txt variant="small">whisper.cpp (bundled)</Txt>
          </Row>
          <Divider style={{marginVertical: 6}} />
          <Row align="space-between">
            <Txt variant="small" color="muted">Language model</Txt>
            <Txt variant="small">llama.cpp (optional)</Txt>
          </Row>
        </Card>
        <Txt variant="micro" color="faint" style={{marginTop: space.lg}}>
          Dayloom 1.0 · local-first
        </Txt>
        <View style={{marginTop: space.sm}}>
          <GhostButton
            label="Test undo log"
            tone="muted"
            onPress={() => {
              if (!db) {
                return;
              }
              void latestUndo(db).then(async entry => {
                if (!entry) {
                  notify({kind: 'info', message: 'Nothing to undo right now.'});
                  return;
                }
                await applyUndo(db, entry.token);
                await refresh();
                notify({kind: 'success', message: 'Restored the last deletion.'});
              });
            }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function shiftMinute(minute: number, delta: number): number {
  return Math.max(0, Math.min(23 * 60 + 45, minute + delta));
}

function dayMinute(minute: number): number {
  const base = new Date();
  base.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return base.getTime();
}

function cycle(value: number, options: number[]): number {
  const index = options.indexOf(value);
  return options[(index + 1) % options.length] ?? options[0]!;
}
