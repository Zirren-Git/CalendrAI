/**
 * AI models: what is bundled, what is optional, and what is actually on disk.
 * A model is only shown as installed when its file exists, its size matches and
 * its pinned SHA-256 was verified.
 */
import React, {useEffect, useState} from 'react';
import {Alert, ScrollView, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {AppBar, Card, GhostButton, ProgressBar, Row, SectionHeader, Txt} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {MODEL_MANIFEST} from '../../models/manifest';
import {compatibilityWarning} from '../../models/manager';
import {MODEL_MANIFEST as manifest} from '../../models/manifest';
import type {ModelEntry, ModelState} from '../../models/types';
import {deviceModelFacts, modelsSupported} from '../../services/models';
import {modelStore} from '../../native/index';
import {modelDisplayStatus} from './modelStatus';

/** Stable empty array so the selector never returns a fresh reference. */
const NO_MODELS: ModelState[] = [];

export function ModelsScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const palette = useTheme();
  const modelStates = useStore(state => state.snapshot?.modelStates ?? NO_MODELS);
  const progress = useStore(state => state.modelProgress);
  const busy = useStore(state => state.busy);
  const downloadModel = useStore(state => state.downloadModel);
  const deleteModel = useStore(state => state.deleteModel);
  const verifyModel = useStore(state => state.verifyModel);
  const refreshModels = useStore(state => state.refreshModels);
  const installBundledModels = useStore(state => state.installBundledModels);
  const notify = useStore(state => state.notify);
  const [facts, setFacts] = useState<{freeSpaceBytes: number; ramMb: number; abi: string} | null>(null);

  useEffect(() => {
    if (!modelsSupported()) {
      return;
    }
    void deviceModelFacts().then(setFacts);
    void refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    if (!modelsSupported()) {
      return;
    }
    const unsubscribe = useStore.getState().modelManager?.subscribe(state => {
      void refreshModels();
      if (state.status === 'error' && state.message) {
        notify({kind: 'error', message: state.message});
      }
    });
    return () => unsubscribe?.();
  }, [notify, refreshModels]);

  const stateFor = (id: string): ModelState | undefined => modelStates.find(state => state.id === id);
  const installedBytes = modelStates
    .filter(state => state.status === 'installed')
    .reduce((sum, state) => sum + state.bytesOnDisk, 0);

  const asr = MODEL_MANIFEST.models.filter(entry => entry.kind === 'asr');
  const llms = MODEL_MANIFEST.models.filter(entry => entry.kind === 'llm');

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <AppBar title="AI models" subtitle="On-device inference only" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{padding: space.lg, paddingBottom: 64}}>
        {!modelsSupported() ? (
          <Card accentColor={palette.danger} style={{marginBottom: space.md}}>
            <Txt variant="small" color="danger" style={{fontWeight: '700'}}>
              Native model support is missing
            </Txt>
            <Txt variant="small" color="muted">
              This build was started without the Android native modules, so models cannot be installed or run here.
              Voice commands and local inference require the APK built from the android/ project.
            </Txt>
          </Card>
        ) : null}

        <Card style={{marginBottom: space.md}}>
          <Txt variant="small" color="muted">
            Speech recognition is bundled so push-to-talk works offline on first launch. The language models are
            optional: every command also works with the built-in parser, with no download at all.
          </Txt>
          <Txt variant="micro" color="faint" style={{marginTop: 6}}>
            {facts
              ? `Device: ${facts.abi} · ${facts.ramMb} MB RAM · ${formatBytes(facts.freeSpaceBytes)} free`
              : 'Reading device capabilities…'}
          </Txt>
          <Txt variant="micro" color="faint" style={{marginTop: 2}}>
            Installed models: {formatBytes(installedBytes)} · manifest verified {manifest.verifiedAt}
          </Txt>
        </Card>

        <SectionHeader title="Speech" hint="Required for voice commands" />
        {asr.map(entry => (
          <ModelCard
            key={entry.id}
            entry={entry}
            state={stateFor(entry.id)}
            progress={progress[entry.id]}
            ramMb={facts?.ramMb}
            busy={busy}
            onDownload={() => void downloadModel(entry.id)}
            onDelete={() => confirmDelete(entry, 'deleteModel')}
            onVerify={() => void verifyModel(entry.id)}
            onRestore={() => void installBundledModels()}
          />
        ))}

        <SectionHeader title="Language models" hint="Optional — improves free-form phrasing" />
        {llms.map(entry => (
          <ModelCard
            key={entry.id}
            entry={entry}
            state={stateFor(entry.id)}
            progress={progress[entry.id]}
            ramMb={facts?.ramMb}
            busy={busy}
            onDownload={() => void downloadModel(entry.id)}
            onDelete={() => confirmDelete(entry, 'deleteModel')}
            onVerify={() => void verifyModel(entry.id)}
            onRestore={() => void installBundledModels()}
          />
        ))}

        <Card style={{marginTop: space.md}}>
          <Txt variant="small" color="muted">
            Downloads use HTTPS from the pinned source in the manifest, resume from a partial file, and are rejected
            unless the size and SHA-256 match. Inference never opens a network connection. Removing a model frees its
            storage immediately.
          </Txt>
        </Card>

        <View style={{marginTop: space.md}}>
          <GhostButton
            label="Restore bundled assets"
            onPress={() => {
              void installBundledModels().then(() =>
                notify({kind: 'success', message: 'Bundled models checked.'}),
              );
            }}
          />
        </View>
        <View style={{marginTop: space.sm}}>
          <GhostButton
            label="Cancel in-flight download"
            tone="muted"
            onPress={() => {
              if (!modelStore.available()) {
                return;
              }
              void modelStore
                .module()
                .cancelDownload()
                .then(() => notify({kind: 'info', message: 'Download cancelled. The partial file is kept for resume.'}))
                .catch(() => notify({kind: 'error', message: 'Nothing to cancel.'}));
            }}
          />
        </View>
      </ScrollView>
    </View>
  );

  function confirmDelete(entry: ModelEntry, _action: 'deleteModel'): void {
    Alert.alert(
      `Delete ${entry.name}?`,
      'The model file will be removed from this device. You can download it again later.',
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Delete', style: 'destructive', onPress: () => void deleteModel(entry.id)},
      ],
    );
  }
}

function ModelCard({
  entry,
  state,
  progress,
  ramMb,
  busy,
  onDownload,
  onDelete,
  onVerify,
  onRestore,
}: {
  entry: ModelEntry;
  state?: ModelState;
  progress?: number;
  ramMb?: number;
  busy: string | null;
  onDownload: () => void;
  onDelete: () => void;
  onVerify: () => void;
  onRestore: () => void;
}): React.JSX.Element {
  const palette = useTheme();
  const status = modelDisplayStatus(state);
  const warning = compatibilityWarning(entry, ramMb);
  const downloading = typeof progress === 'number' && progress < 1;
  return (
    <Card style={{marginBottom: space.sm}} accentColor={status.color(palette)}>
      <Row align="space-between" style={{marginBottom: 2}}>
        <Txt variant="h3" style={{flex: 1}} numberOfLines={1}>
          {entry.name}
        </Txt>
        <Txt variant="micro" style={{color: status.color(palette), fontWeight: '700'}}>
          {status.label}
        </Txt>
      </Row>
      <Txt variant="small" color="muted">
        {entry.description}
      </Txt>
      <Txt variant="micro" color="faint" style={{marginTop: 4}}>
        {formatBytes(entry.sizeBytes)} · {entry.languages} · {entry.quantization ?? 'full precision'} ·{' '}
        {entry.bundled ? 'bundled with the app' : 'optional download'}
      </Txt>
      <Txt variant="micro" color="faint">
        {entry.license.name} · {entry.source.repository}
      </Txt>
      <Txt variant="micro" color="faint" style={{marginTop: 2}}>
        {entry.compatibility}
      </Txt>
      {warning ? (
        <Txt variant="micro" color="danger" style={{marginTop: 4}}>
          {warning}
        </Txt>
      ) : null}
      {state && state.status === 'unavailable' ? (
        <Txt variant="micro" color="danger" style={{marginTop: 4}}>
          {state.message ?? entry.unavailableReason ?? 'Not available'}
        </Txt>
      ) : null}
      {state && state.status !== 'installed' && state.message && state.status !== 'not_installed' ? (
        <Txt variant="micro" color="muted" style={{marginTop: 4}}>
          {state.message}
        </Txt>
      ) : null}
      {downloading ? (
        <View style={{marginTop: 6}}>
          <ProgressBar value={progress ?? 0} color={palette.accent} label={`${entry.name} download progress`} />
          <Txt variant="micro" color="faint" style={{marginTop: 2}}>
            {Math.round((progress ?? 0) * 100)}% · resume supported
          </Txt>
        </View>
      ) : null}
      <Row gap={6} style={{marginTop: space.sm, flexWrap: 'wrap'}}>
        {status.label === 'Installed' ? (
          <>
            <GhostButton label="Verify" onPress={onVerify} />
            <GhostButton label="Delete" tone="danger" onPress={onDelete} />
          </>
        ) : entry.bundled ? (
          <GhostButton label="Restore bundled" onPress={onRestore} />
        ) : (
          <GhostButton
            label={downloading ? 'Downloading…' : busy ? 'Please wait' : 'Download'}
            onPress={onDownload}
            disabled={downloading || Boolean(busy)}
          />
        )}
      </Row>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 MB';
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}
