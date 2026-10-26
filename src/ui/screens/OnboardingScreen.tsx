/**
 * First run: three honest screens.
 *
 * The middle screen tells the truth about what works immediately (bundled
 * Whisper + built-in parser) and what is optional (a downloaded language model),
 * including sizes. Nothing large downloads here.
 */
import React, {useEffect, useState} from 'react';
import {ScrollView, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Card, GhostButton, PrimaryButton, Row, Txt} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {MODEL_MANIFEST} from '../../models/manifest';
import {modelsSupported} from '../../services/models';
import {speechReady} from '../../services/speech';
import type {AppNavigation} from '../navigation';
import type {ModelState} from '../../models/types';

/** Stable empty array so the selector never returns a fresh reference. */
const NO_MODELS: ModelState[] = [];

export function OnboardingScreen(): React.JSX.Element {
  const navigation = useNavigation<AppNavigation>();
  const palette = useTheme();
  const insets = useSafeAreaInsets();
  const updateSetting = useStore(state => state.updateSetting);
  const modelManager = useStore(state => state.modelManager);
  const modelStates = useStore(state => state.snapshot?.modelStates ?? NO_MODELS);
  const [step, setStep] = useState(0);
  const [speech, setSpeech] = useState<'checking' | 'ready' | 'missing'>('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!modelsSupported()) {
      setSpeech('missing');
      return;
    }
    let alive = true;
    void speechReady(modelManager).then(ready => {
      if (alive) {
        setSpeech(ready ? 'ready' : 'missing');
      }
    });
    return () => {
      alive = false;
    };
  }, [modelManager]);

  const finish = async (): Promise<void> => {
    setBusy(true);
    await updateSetting('onboarded', true);
    setBusy(false);
    navigation.reset({index: 0, routes: [{name: 'Home'}]});
  };

  const whisper = MODEL_MANIFEST.models.find(entry => entry.id === 'whisper-tiny');
  const llms = MODEL_MANIFEST.models.filter(entry => entry.kind === 'llm');
  const installedLlm = modelStates.find(state => state.status === 'installed' && llms.some(llm => llm.id === state.id));

  return (
    <View style={{flex: 1, backgroundColor: palette.bg, paddingTop: insets.top}}>
      <ScrollView contentContainerStyle={{padding: space.xl, paddingBottom: 32, flexGrow: 1}}>
        {step === 0 ? (
          <View style={{gap: space.md}}>
            <Txt variant="display">Dayloom</Txt>
            <Txt variant="h2" color="muted">
              Your calendar, tasks and notes — kept on this phone.
            </Txt>
            <Card>
              <Txt variant="small" color="muted">
                No account. No cloud. No analytics. Everything you type, record or plan is stored in this app’s
                private storage and stays there.
              </Txt>
            </Card>
            <Card>
              <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 4}}>
                What is local
              </Txt>
              {['Calendar, tasks, projects and notes', 'Habit history and focus sessions', 'Speech transcripts and AI prompts', 'Backups and exports you start yourself'].map(item => (
                <Txt key={item} variant="small" color="muted">
                  · {item}
                </Txt>
              ))}
            </Card>
          </View>
        ) : null}

        {step === 1 ? (
          <View style={{gap: space.md}}>
            <Txt variant="h1">Talk to it offline</Txt>
            <Txt variant="body" color="muted">
              Push-to-talk transcribes with Whisper Tiny, which ships inside the app. A built-in parser turns the
              words into a plan you confirm before anything is saved.
            </Txt>
            <Card accentColor={speech === 'ready' ? palette.sage : palette.gold}>
              <Txt variant="h3">
                {speech === 'ready' ? 'Voice is ready' : speech === 'checking' ? 'Checking the speech model…' : 'Speech model needs attention'}
              </Txt>
              <Txt variant="small" color="muted">
                {speech === 'ready'
                  ? `${whisper?.name ?? 'Whisper Tiny'} is installed and verified. Typed commands work whatever happens to the microphone.`
                  : 'The bundled model could not be verified. You can still type every command; reinstall or restore it from AI models.'}
              </Txt>
            </Card>
            <Card>
              <Txt variant="small" color="muted">
                Try “Lunch with Ana tomorrow at 12:30” or “Add task: send the deck by Friday”. Dayloom shows the
                interpreted action, then waits for you.
              </Txt>
            </Card>
          </View>
        ) : null}

        {step === 2 ? (
          <View style={{gap: space.md}}>
            <Txt variant="h1">Optional language model</Txt>
            <Txt variant="body" color="muted">
              Every command works without this. A larger local model only helps with unusual phrasing — it runs on
              this device and needs storage you choose to give it.
            </Txt>
            {llms.map(entry => (
              <Card key={entry.id}>
                <Row align="space-between">
                  <Txt variant="h3" style={{flex: 1}} numberOfLines={1}>
                    {entry.name}
                  </Txt>
                  <Txt variant="micro" color="muted">
                    {Math.round(entry.sizeBytes / (1024 * 1024 * 1024) * 10) / 10} GB
                  </Txt>
                </Row>
                <Txt variant="micro" color="faint">
                  {entry.compatibility}
                </Txt>
              </Card>
            ))}
            <Txt variant="small" color="faint">
              {installedLlm
                ? `${installedLlm.id} is installed.`
                : 'Nothing large will download unless you ask for it in AI models.'}
            </Txt>
          </View>
        ) : null}

        <View style={{flex: 1}} />
        <Row gap={8} style={{marginTop: space.xl}}>
          {step > 0 ? <GhostButton label="Back" tone="muted" onPress={() => setStep(value => value - 1)} /> : null}
          <View style={{flex: 1}}>
            {step < 2 ? (
              <PrimaryButton label="Continue" onPress={() => setStep(value => value + 1)} />
            ) : (
              <PrimaryButton label={busy ? 'Opening…' : 'Start using Dayloom'} onPress={() => void finish()} loading={busy} />
            )}
          </View>
        </Row>
        {step === 2 ? (
          <View style={{marginTop: space.sm}}>
            <GhostButton label="Set up a model later" tone="muted" onPress={() => void finish()} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
