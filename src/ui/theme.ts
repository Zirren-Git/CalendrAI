/**
 * Design tokens.
 *
 * A warm paper-and-ink palette: terracotta for actions, sage for habits,
 * gold for focus, plum for notes. Display text is serif, everything else is
 * the platform sans, which keeps dense lists readable at small sizes.
 */
import {useColorScheme} from 'react-native';
import {useStore} from '../state/store';

export interface Palette {
  mode: 'light' | 'dark';
  bg: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  accent: string;
  accentInk: string;
  sage: string;
  gold: string;
  plum: string;
  sky: string;
  danger: string;
  success: string;
  shadow: string;
}

export const LIGHT: Palette = {
  mode: 'light',
  bg: '#F6F2E9',
  surface: '#FFFCF5',
  surfaceAlt: '#EFE9DB',
  ink: '#23201B',
  muted: '#6E6659',
  faint: '#9A9081',
  line: '#E2D9C8',
  accent: '#B4553C',
  accentInk: '#FFF7F3',
  sage: '#5F7256',
  gold: '#A9762F',
  plum: '#71557A',
  sky: '#436E85',
  danger: '#A33A2C',
  success: '#4C7452',
  shadow: '#2A2419',
};

export const DARK: Palette = {
  mode: 'dark',
  bg: '#14120E',
  surface: '#1E1B15',
  surfaceAlt: '#282319',
  ink: '#F2ECDF',
  muted: '#A79E8D',
  faint: '#7C7466',
  line: '#352F24',
  accent: '#D9764F',
  accentInk: '#1A120E',
  sage: '#9AB189',
  gold: '#D6A75F',
  plum: '#B394B9',
  sky: '#83AEC0',
  danger: '#E07A64',
  success: '#8AB98F',
  shadow: '#000000',
};

export const space = {xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32} as const;
export const radius = {sm: 8, md: 12, lg: 18, xl: 26, pill: 999} as const;

export const type = {
  display: {fontFamily: 'serif', fontSize: 32, lineHeight: 38, letterSpacing: -0.4},
  h1: {fontFamily: 'serif', fontSize: 25, lineHeight: 31, letterSpacing: -0.3},
  h2: {fontFamily: 'serif', fontSize: 20, lineHeight: 26},
  h3: {fontSize: 16, fontWeight: '700' as const, lineHeight: 21},
  body: {fontSize: 15, lineHeight: 22},
  small: {fontSize: 13, lineHeight: 18},
  micro: {fontSize: 11, lineHeight: 15, letterSpacing: 0.3},
} as const;

export function useTheme(): Palette {
  const preference = useStore(state => state.settings?.theme ?? 'system');
  const system = useColorScheme();
  const mode = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  return mode === 'dark' ? DARK : LIGHT;
}

/** Event colours are stored as hex strings; this keeps them legible in both modes. */
export function readableOn(hex: string): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return '#FFFFFF';
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#23201B' : '#FFFFFF';
}

export const EVENT_COLORS = ['#B4553C', '#5F7256', '#436E85', '#71557A', '#A9762F', '#8A5A44'];
