/**
 * Dayloom root.
 *
 * Boot opens the single local SQLite database, runs migrations, seeds defaults
 * and verifies the bundled speech model. Everything after that reads from the
 * store; there is no network call anywhere in this path.
 */
import React, {useEffect} from 'react';
import {ActivityIndicator, AppState, StyleSheet, Text, View} from 'react-native';
import {NavigationContainer, DefaultTheme, DarkTheme} from '@react-navigation/native';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {useStore} from './src/state/store';
import {RootNavigator} from './src/ui/navigation';
import {useTheme, space} from './src/ui/theme';

export default function App(): React.JSX.Element {
  const boot = useStore(state => state.boot);
  const refresh = useStore(state => state.refresh);
  const ready = useStore(state => state.ready);
  const bootError = useStore(state => state.bootError);
  const onboarded = useStore(state => state.settings.onboarded);
  const palette = useTheme();

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', status => {
      if (status === 'active') {
        void refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  const navigationTheme = palette.mode === 'dark'
    ? {...DarkTheme, colors: {...DarkTheme.colors, background: palette.bg, card: palette.surface, text: palette.ink, border: palette.line, primary: palette.accent}}
    : {...DefaultTheme, colors: {...DefaultTheme.colors, background: palette.bg, card: palette.surface, text: palette.ink, border: palette.line, primary: palette.accent}};

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={palette.mode === 'dark' ? 'light-content' : 'dark-content'} />
      {!ready ? (
        <View style={[styles.center, {backgroundColor: palette.bg}]}>
          <Text style={{color: palette.ink, fontFamily: 'serif', fontSize: 30, marginBottom: space.md}}>
            Dayloom
          </Text>
          <ActivityIndicator color={palette.accent} />
          <Text style={{color: palette.muted, marginTop: space.md, fontSize: 13}}>Opening your local calendar…</Text>
        </View>
      ) : bootError ? (
        <View style={[styles.center, {backgroundColor: palette.bg}]}>
          <Text style={{color: palette.ink, fontFamily: 'serif', fontSize: 22, marginBottom: 8}}>
            The database could not be opened
          </Text>
          <Text style={{color: palette.muted, textAlign: 'center', paddingHorizontal: 32}}>{bootError}</Text>
          <Text style={{color: palette.faint, textAlign: 'center', paddingHorizontal: 32, marginTop: 12, fontSize: 12}}>
            Your existing data was not deleted. Restart the app, and if this persists, export a backup from a
            build that can open it.
          </Text>
        </View>
      ) : (
        <NavigationContainer theme={navigationTheme}>
          <RootNavigator onboarded={onboarded} />
        </NavigationContainer>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
});
