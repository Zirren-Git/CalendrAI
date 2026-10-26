/**
 * Home: a custom five-tab shell (Today, Calendar, Tasks, Notes, More) plus the
 * assistant entry point. A custom bar keeps the tab set independent from the
 * stack while staying inside one screen, which keeps navigation state simple.
 */
import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, View} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import {Txt, NoticeBar} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {launcherWidgets} from '../../native/index';
import {WidgetGrid} from '../widgets/WidgetGrid';
import {CalendarScreen} from './CalendarScreen';
import {TasksScreen} from './TasksScreen';
import {NotesScreen} from './NotesScreen';
import {MoreScreen} from './MoreScreen';
import type {AppNavigation, RootStackParamList} from '../navigation';
import type {WidgetTarget} from '../widgets/types';
import {formatDateKey} from '../../domain/time';
import {WEEKDAY_SHORT} from '../format';

export type HomeTab = 'today' | 'calendar' | 'tasks' | 'notes' | 'more';

const TABS: {key: HomeTab; label: string; glyph: string}[] = [
  {key: 'today', label: 'Today', glyph: '◉'},
  {key: 'calendar', label: 'Calendar', glyph: '▤'},
  {key: 'tasks', label: 'Tasks', glyph: '✓'},
  {key: 'notes', label: 'Notes', glyph: '✎'},
  {key: 'more', label: 'More', glyph: '⋯'},
];

export function HomeScreen(): React.JSX.Element {
  const navigation = useNavigation<AppNavigation>();
  const route = useRoute<RouteProp<RootStackParamList, 'Home'>>();
  const palette = useTheme();
  const insets = useSafeAreaInsets();
  const snapshot = useStore(state => state.snapshot);
  const undo = useStore(state => state.undo);
  const undoLast = useStore(state => state.undoLast);
  const [tab, setTab] = useState<HomeTab>(route.params?.tab ?? 'today');
  const [calendarDate, setCalendarDate] = useState<string | undefined>(route.params?.date);
  const [taskFilter, setTaskFilter] = useState<string | undefined>();
  const [projectId, setProjectId] = useState<string | undefined>(route.params?.projectId);
  const [notebookId, setNotebookId] = useState<string | undefined>(route.params?.notebookId);

  useEffect(() => {
    if (route.params?.assistant) {
      navigation.navigate('Assistant', {});
    }
  }, [route.params?.assistant, navigation]);

  // A launcher-widget tap stores a route natively; consume it once on mount.
  useEffect(() => {
    let alive = true;
    void launcherWidgets.consumeLaunchTarget().then(target => {
      if (!alive || !target) {
        return;
      }
      switch (target) {
        case 'assistant':
          navigation.navigate('Assistant', {});
          break;
        case 'focus':
          navigation.navigate('Focus', {});
          break;
        case 'habits':
          navigation.navigate('Habits');
          break;
        case 'calendar':
          setTab('calendar');
          break;
        case 'tasks':
          setTab('tasks');
          break;
        case 'notes':
          setTab('notes');
          break;
        default:
          setTab('today');
      }
    });
    return () => {
      alive = false;
    };
  }, [navigation]);

  const openTarget = (target: WidgetTarget, params?: Record<string, unknown>): void => {
    switch (target) {
      case 'event':
        navigation.navigate('EventEditor', {
          id: typeof params?.id === 'string' ? params.id : undefined,
          start: typeof params?.start === 'number' ? params.start : undefined,
          end: typeof params?.end === 'number' ? params.end : undefined,
        });
        break;
      case 'task':
        navigation.navigate('TaskEditor', {
          id: typeof params?.id === 'string' ? params.id : undefined,
          projectId: typeof params?.projectId === 'string' ? params.projectId : undefined,
        });
        break;
      case 'note':
        navigation.navigate('NoteEditor', {
          id: typeof params?.id === 'string' ? params.id : undefined,
          journal: params?.journal === true,
        });
        break;
      case 'calendar':
        setCalendarDate(typeof params?.date === 'string' ? params.date : undefined);
        setTab('calendar');
        break;
      case 'tasks':
        setTaskFilter(typeof params?.filter === 'string' ? params.filter : undefined);
        setProjectId(typeof params?.projectId === 'string' ? params.projectId : undefined);
        setTab('tasks');
        break;
      case 'notes':
        setNotebookId(typeof params?.notebookId === 'string' ? params.notebookId : undefined);
        setTab('notes');
        break;
      case 'habits':
        navigation.navigate('Habits');
        break;
      case 'focus':
        navigation.navigate('Focus', {
          taskId: typeof params?.taskId === 'string' ? params.taskId : undefined,
          label: typeof params?.label === 'string' ? params.label : undefined,
        });
        break;
      case 'plan':
        navigation.navigate('Plan', {});
        break;
      case 'insights':
        navigation.navigate('Insights');
        break;
      case 'search':
        navigation.navigate('Search');
        break;
      case 'settings':
        navigation.navigate('Settings');
        break;
      case 'assistant':
        navigation.navigate('Assistant', {});
        break;
      default:
        setTab('today');
    }
  };

  const openAssistant = (): void => {
    navigation.navigate('Assistant', {});
  };

  const dateLabel = snapshot
    ? `${WEEKDAY_SHORT[new Date(`${snapshot.todayKey}T12:00:00Z`).getUTCDay()]} · ${formatDateKey(snapshot.todayKey, 'long')}`
    : '';

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: palette.bg}} edges={['top']}>
      <View style={{paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs}}>
        <View style={{flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between'}}>
          <View style={{flex: 1}}>
            <Txt variant="display">{greeting()}</Txt>
            <Txt variant="small" color="muted">
              {dateLabel}
            </Txt>
          </View>
          <View style={{flexDirection: 'row', gap: 4}}>
            <IconGlyph glyph="⌕" label="Search" onPress={() => navigation.navigate('Search')} />
            <IconGlyph glyph="✦" label="Open assistant" onPress={openAssistant} accent />
          </View>
        </View>
      </View>

      {undo ? (
        <Pressable
          onPress={() => void undoLast()}
          accessibilityRole="button"
          accessibilityLabel={`Undo ${undo.label}`}
          style={{
            marginHorizontal: space.lg,
            marginBottom: 4,
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingVertical: 6,
          }}>
          <Txt variant="micro" color="muted">
            {undo.label}
          </Txt>
          <Txt variant="micro" color="accent" style={{fontWeight: '800'}}>
            UNDO
          </Txt>
        </Pressable>
      ) : null}

      <View style={{flex: 1}}>
        {tab === 'today' ? (
          <ScrollView
            style={{flex: 1}}
            contentContainerStyle={{paddingHorizontal: space.lg, paddingBottom: 120}}
            keyboardShouldPersistTaps="handled">
            <WidgetGrid onNavigate={openTarget} openAssistant={openAssistant} />
          </ScrollView>
        ) : null}
        {tab === 'calendar' ? (
          <CalendarScreen
            focusDate={calendarDate}
            onOpenEvent={id => navigation.navigate('EventEditor', {id})}
            onNewEvent={(start, end) => navigation.navigate('EventEditor', {start, end})}
            onOpenAssistant={openAssistant}
          />
        ) : null}
        {tab === 'tasks' ? (
          <TasksScreen
            initialFilter={taskFilter}
            projectId={projectId}
            onOpenTask={id => navigation.navigate('TaskEditor', {id})}
            onNewTask={() => navigation.navigate('TaskEditor', {projectId})}
            onOpenAssistant={openAssistant}
          />
        ) : null}
        {tab === 'notes' ? (
          <NotesScreen
            notebookId={notebookId}
            onOpenNote={id => navigation.navigate('NoteEditor', {id})}
            onNewNote={journal => navigation.navigate('NoteEditor', {journal})}
          />
        ) : null}
        {tab === 'more' ? <MoreScreen onNavigate={openTarget} /> : null}
      </View>

      <View
        style={{
          flexDirection: 'row',
          borderTopWidth: 1,
          borderTopColor: palette.line,
          backgroundColor: palette.surface,
          paddingBottom: Math.max(insets.bottom, 6),
          paddingTop: 6,
        }}>
        {TABS.map(entry => {
          const active = entry.key === tab;
          return (
            <Pressable
              key={entry.key}
              onPress={() => setTab(entry.key)}
              accessibilityRole="tab"
              accessibilityState={{selected: active}}
              accessibilityLabel={entry.label}
              style={{flex: 1, alignItems: 'center', gap: 2, paddingVertical: 6, minHeight: 48}}>
              <Txt variant="small" style={{color: active ? palette.accent : palette.faint, fontSize: 16}}>
                {entry.glyph}
              </Txt>
              <Txt variant="micro" style={{color: active ? palette.ink : palette.muted, fontWeight: active ? '700' : '400'}}>
                {entry.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {tab === 'today' || tab === 'calendar' || tab === 'tasks' ? (
        <Pressable
          onPress={openAssistant}
          accessibilityRole="button"
          accessibilityLabel="Open the local assistant"
          style={{
            position: 'absolute',
            right: space.lg,
            bottom: insets.bottom + 78,
            width: 54,
            height: 54,
            borderRadius: 27,
            backgroundColor: palette.ink,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: palette.shadow,
            shadowOpacity: 0.2,
            shadowRadius: 8,
            shadowOffset: {width: 0, height: 4},
            elevation: 6,
          }}>
          <Txt variant="h2" style={{color: palette.bg}}>
            ✦
          </Txt>
        </Pressable>
      ) : null}

      <NoticeBar />
    </SafeAreaView>
  );
}

function IconGlyph({
  glyph,
  label,
  onPress,
  accent,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  accent?: boolean;
}): React.JSX.Element {
  const palette = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: accent ? palette.surfaceAlt : 'transparent',
      }}>
      <Txt variant="h3" style={{color: accent ? palette.accent : palette.muted}}>
        {glyph}
      </Txt>
    </Pressable>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) {
    return 'Late night';
  }
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 18) {
    return 'Good afternoon';
  }
  return 'Good evening';
}
