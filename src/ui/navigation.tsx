import {createNativeStackNavigator} from '@react-navigation/native-stack';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {OnboardingScreen} from './screens/OnboardingScreen';
import {HomeScreen, type HomeTab} from './screens/HomeScreen';
import {EventEditorScreen} from './screens/EventEditorScreen';
import {TaskEditorScreen} from './screens/TaskEditorScreen';
import {NoteEditorScreen} from './screens/NoteEditorScreen';
import {AssistantScreen} from './screens/AssistantScreen';
import {SettingsScreen} from './screens/SettingsScreen';
import {ModelsScreen} from './screens/ModelsScreen';
import {SearchScreen} from './screens/SearchScreen';
import {FocusScreen} from './screens/FocusScreen';
import {HabitsScreen} from './screens/HabitsScreen';
import {PlanScreen} from './screens/PlanScreen';
import {InsightsScreen} from './screens/InsightsScreen';

export type RootStackParamList = {
  Onboarding: undefined;
  Home:
    | {
        tab?: HomeTab;
        date?: string;
        notebookId?: string;
        projectId?: string;
        journal?: boolean;
        assistant?: boolean;
      }
    | undefined;
  EventEditor: {id?: string; start?: number; end?: number; occurrenceStart?: number};
  TaskEditor: {id?: string; parentId?: string; projectId?: string; title?: string};
  NoteEditor: {id?: string; journal?: boolean};
  Assistant: {seed?: string} | undefined;
  Settings: undefined;
  Models: undefined;
  Search: undefined;
  Focus: {taskId?: string; label?: string};
  Habits: undefined;
  Plan: {tab?: 'goals' | 'routines' | 'review'} | undefined;
  Insights: undefined;
};

export type AppNavigation = NativeStackNavigationProp<RootStackParamList>;

export const Stack = createNativeStackNavigator<RootStackParamList>();

/** Screens are edge-to-edge; each screen paints its own background. */
export const screenOptions = {
  headerShown: false,
  animation: 'slide_from_right' as const,
  contentStyle: {backgroundColor: 'transparent'},
};

export function RootNavigator({onboarded}: {onboarded: boolean}): React.JSX.Element {
  return (
    <Stack.Navigator initialRouteName={onboarded ? 'Home' : 'Onboarding'} screenOptions={screenOptions}>
      <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{animation: 'fade'}} />
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="EventEditor" component={EventEditorScreen} options={{presentation: 'modal'}} />
      <Stack.Screen name="TaskEditor" component={TaskEditorScreen} options={{presentation: 'modal'}} />
      <Stack.Screen name="NoteEditor" component={NoteEditorScreen} options={{presentation: 'modal'}} />
      <Stack.Screen name="Assistant" component={AssistantScreen} options={{presentation: 'modal'}} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Models" component={ModelsScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="Focus" component={FocusScreen} options={{presentation: 'modal'}} />
      <Stack.Screen name="Habits" component={HabitsScreen} />
      <Stack.Screen name="Plan" component={PlanScreen} />
      <Stack.Screen name="Insights" component={InsightsScreen} />
    </Stack.Navigator>
  );
}
