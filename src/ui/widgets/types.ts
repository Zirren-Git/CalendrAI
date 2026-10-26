import type {ReactNode} from 'react';
import type {Settings} from '../../domain/types';
import type {Snapshot} from '../../state/store';
import type {Palette} from '../theme';

export type WidgetTarget =
  | 'dashboard'
  | 'calendar'
  | 'tasks'
  | 'notes'
  | 'habits'
  | 'focus'
  | 'plan'
  | 'insights'
  | 'assistant'
  | 'search'
  | 'settings'
  | 'event'
  | 'task'
  | 'note';

export interface WidgetContext {
  snapshot: Snapshot;
  settings: Settings;
  config: Record<string, unknown>;
  palette: Palette;
  navigate: (target: WidgetTarget, params?: Record<string, unknown>) => void;
  openAssistant: () => void;
}

export type ConfigField =
  | {key: string; label: string; type: 'select'; options: {value: string; label: string}[]}
  | {key: string; label: string; type: 'toggle'; description?: string}
  | {key: string; label: string; type: 'number'; min: number; max: number};

export interface WidgetMeta {
  kind: string;
  title: string;
  group: 'Calendar' | 'Tasks' | 'Habits' | 'Focus' | 'Notes' | 'Planning';
  description: string;
  defaultSpan: 1 | 2;
  configFields: ConfigField[];
}

export interface WidgetDefinition extends WidgetMeta {
  render: (ctx: WidgetContext) => ReactNode;
}
