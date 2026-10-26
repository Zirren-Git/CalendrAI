/** Maps a model state to a short, honest label and colour. */
import type {Palette} from '../theme';
import type {ModelState} from '../../models/types';

export function modelDisplayStatus(state: ModelState | undefined): {
  label: string;
  color: (palette: Palette) => string;
} {
  if (!state) {
    return {label: 'Checking', color: palette => palette.faint};
  }
  switch (state.status) {
    case 'installed':
      return {label: 'Installed', color: palette => palette.success};
    case 'downloading':
      return {label: 'Downloading', color: palette => palette.sky};
    case 'verifying':
      return {label: 'Verifying', color: palette => palette.sky};
    case 'unverified':
      return {label: 'Unverified', color: palette => palette.gold};
    case 'verification_failed':
      return {label: 'Checksum failed', color: palette => palette.danger};
    case 'unavailable':
      return {label: 'Unavailable', color: palette => palette.faint};
    case 'insufficient_storage':
      return {label: 'No space', color: palette => palette.danger};
    case 'incompatible':
      return {label: 'Incompatible', color: palette => palette.danger};
    case 'error':
      return {label: 'Error', color: palette => palette.danger};
    case 'not_installed':
    default:
      return {label: 'Not installed', color: palette => palette.muted};
  }
}
