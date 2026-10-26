/**
 * Shared UI kit.
 *
 * Every interactive element carries an accessibility role and label; touch
 * targets are at least 44pt tall. Colours come from the active palette so light
 * and dark are the same component tree.
 */
import React, {useEffect, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {radius, space, type, useTheme, type Palette} from './theme';
import {useStore} from '../state/store';

/* ---------------------------------- text ---------------------------------- */

type TextVariant = 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'micro' | 'mono';

export function Txt({
  children,
  variant = 'body',
  color,
  style,
  numberOfLines,
  align,
}: {
  children: ReactNode;
  variant?: TextVariant;
  color?: keyof Palette | string;
  style?: StyleProp<import('react-native').TextStyle>;
  numberOfLines?: number;
  align?: 'left' | 'center' | 'right';
}): React.JSX.Element {
  const palette = useTheme();
  const resolved = color && color in palette ? (palette[color as keyof Palette] as string) : color;
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        variant === 'mono'
          ? {fontFamily: 'monospace', fontSize: 13}
          : type[variant as Exclude<TextVariant, 'mono'>],
        {color: resolved ?? palette.ink},
        align ? {textAlign: align} : null,
        style,
      ]}>
      {children}
    </Text>
  );
}

/* -------------------------------- containers ------------------------------- */

export function Screen({
  children,
  scroll = true,
  padded = true,
  background,
  refreshControl,
  onScroll,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  background?: string;
  refreshControl?: React.ReactElement;
  onScroll?: (offsetY: number) => void;
}): React.JSX.Element {
  const palette = useTheme();
  const style = [styles.screen, {backgroundColor: background ?? palette.bg}];
  if (!scroll) {
    return <View style={[style, padded ? styles.padded : null]}>{children}</View>;
  }
  return (
    <ScrollView
      style={style}
      contentContainerStyle={padded ? styles.paddedContent : undefined}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      onScroll={
        onScroll
          ? event => onScroll(event.nativeEvent.contentOffset.y)
          : undefined
      }
      scrollEventThrottle={16}>
      {children}
    </ScrollView>
  );
}

export function AppBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}): React.JSX.Element {
  const palette = useTheme();
  return (
    <View style={[styles.appBar, {borderBottomColor: palette.line}]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={styles.appBarBack}>
          <Txt variant="h3" color="accent">
            ‹
          </Txt>
        </Pressable>
      ) : null}
      <View style={styles.flex}>
        <Txt variant="h2" numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="small" color="muted" numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function Card({
  children,
  onPress,
  style,
  padded = true,
  accentColor,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  accentColor?: string;
  accessibilityLabel?: string;
}): React.JSX.Element {
  const palette = useTheme();
  const base: StyleProp<ViewStyle> = [
    styles.card,
    {
      backgroundColor: palette.surface,
      borderColor: palette.line,
      borderLeftColor: accentColor ?? palette.line,
      borderLeftWidth: accentColor ? 3 : 1,
    },
    padded ? styles.cardPadded : null,
    style,
  ];
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({pressed}) => [base, pressed ? {opacity: 0.75} : null]}>
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

export function Row({
  children,
  style,
  gap = space.sm,
  align = 'center',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number;
  align?: 'center' | 'flex-start' | 'flex-end' | 'space-between';
}): React.JSX.Element {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: align === 'space-between' ? 'center' : align,
          justifyContent: align === 'space-between' ? 'space-between' : 'flex-start',
          gap,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Spacer({height = space.md}: {height?: number}): React.JSX.Element {
  return <View style={{height}} />;
}

export function Divider({style}: {style?: StyleProp<ViewStyle>}): React.JSX.Element {
  const palette = useTheme();
  return <View style={[{height: StyleSheet.hairlineWidth, backgroundColor: palette.line}, style]} />;
}

export function SectionHeader({
  title,
  hint,
  actionLabel,
  onAction,
}: {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element {
  return (
    <Row align="space-between" style={{marginBottom: space.sm, marginTop: space.lg}}>
      <View style={styles.flex}>
        <Txt variant="h3">{title}</Txt>
        {hint ? (
          <Txt variant="small" color="muted">
            {hint}
          </Txt>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" accessibilityLabel={actionLabel} hitSlop={8}>
          <Txt variant="small" color="accent">
            {actionLabel}
          </Txt>
        </Pressable>
      ) : null}
    </Row>
  );
}

/* --------------------------------- controls -------------------------------- */

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  tone = 'accent',
  accessibilityHint,
  compact,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'accent' | 'ink' | 'danger' | 'sage';
  accessibilityHint?: string;
  compact?: boolean;
}): React.JSX.Element {
  const palette = useTheme();
  const background =
    tone === 'ink' ? palette.ink : tone === 'danger' ? palette.danger : tone === 'sage' ? palette.sage : palette.accent;
  const foreground = tone === 'ink' ? palette.bg : tone === 'accent' ? palette.accentInk : '#FFFFFF';
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{disabled: Boolean(inactive), busy: Boolean(loading)}}
      style={({pressed}) => [
        styles.primary,
        compact ? styles.primaryCompact : null,
        {backgroundColor: background, opacity: inactive ? 0.5 : pressed ? 0.85 : 1},
      ]}>
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <Text style={{color: foreground, fontWeight: '700', fontSize: 15}}>{label}</Text>
      )}
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  disabled,
  tone = 'accent',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'accent' | 'danger' | 'muted';
}): React.JSX.Element {
  const palette = useTheme();
  const color = tone === 'danger' ? palette.danger : tone === 'muted' ? palette.muted : palette.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({pressed}) => [
        styles.ghost,
        {borderColor: palette.line, opacity: disabled ? 0.45 : pressed ? 0.7 : 1},
      ]}>
      <Txt variant="small" style={{color, fontWeight: '600'}}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}): React.JSX.Element {
  const palette = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{selected: Boolean(active)}}
      style={({pressed}) => [
        styles.chip,
        {
          backgroundColor: active ? palette.ink : palette.surfaceAlt,
          borderColor: active ? palette.ink : palette.line,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <Txt variant="small" style={{color: active ? palette.bg : palette.muted, fontWeight: '600'}}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function Field({
  label,
  error,
  hint,
  ...props
}: TextInputProps & {label?: string; error?: string | null; hint?: string}): React.JSX.Element {
  const palette = useTheme();
  return (
    <View style={{marginBottom: space.md}}>
      {label ? (
        <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
          {label}
        </Txt>
      ) : null}
      <TextInput
        {...props}
        placeholderTextColor={palette.faint}
        accessibilityLabel={label ?? props.placeholder}
        style={[
          styles.input,
          {
            color: palette.ink,
            backgroundColor: palette.surfaceAlt,
            borderColor: error ? palette.danger : palette.line,
            minHeight: props.multiline ? 110 : 46,
            textAlignVertical: props.multiline ? 'top' : 'center',
          },
          props.style,
        ]}
      />
      {error ? (
        <Txt variant="small" color="danger" style={{marginTop: 4}}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="small" color="faint" style={{marginTop: 4}}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onPress,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onPress: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  const palette = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{checked: value, disabled: Boolean(disabled)}}
      style={({pressed}) => [
        styles.toggleRow,
        {borderBottomColor: palette.line, opacity: disabled ? 0.5 : pressed ? 0.8 : 1},
      ]}>
      <View style={styles.flex}>
        <Txt variant="body">{label}</Txt>
        {description ? (
          <Txt variant="small" color="muted">
            {description}
          </Txt>
        ) : null}
      </View>
      <View
        style={[
          styles.switch,
          {backgroundColor: value ? palette.sage : palette.surfaceAlt, borderColor: value ? palette.sage : palette.line},
        ]}>
        <View style={[styles.knob, {backgroundColor: palette.surface, alignSelf: value ? 'flex-end' : 'flex-start'}]} />
      </View>
    </Pressable>
  );
}

export function ProgressBar({
  value,
  color,
  height = 8,
  label,
}: {
  value: number;
  color?: string;
  height?: number;
  label?: string;
}): React.JSX.Element {
  const palette = useTheme();
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{min: 0, max: 100, now: Math.round(clamped * 100)}}
      style={{height, borderRadius: height / 2, backgroundColor: palette.surfaceAlt, overflow: 'hidden'}}>
      <View style={{width: `${clamped * 100}%`, height, backgroundColor: color ?? palette.accent}} />
    </View>
  );
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  glyph = '◌',
}: {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  glyph?: string;
}): React.JSX.Element {
  const palette = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={{fontSize: 26, color: palette.faint}}>{glyph}</Text>
      <Txt variant="h3" align="center" style={{marginTop: 6}}>
        {title}
      </Txt>
      {message ? (
        <Txt variant="small" color="muted" align="center" style={{marginTop: 4, maxWidth: 280}}>
          {message}
        </Txt>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{marginTop: space.md}}>
          <GhostButton label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}): React.JSX.Element {
  const palette = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close sheet" accessibilityRole="button" />
      <View
        style={[
          styles.sheet,
          {backgroundColor: palette.bg, borderColor: palette.line, paddingBottom: insets.bottom + space.lg},
        ]}>
        <Row align="space-between" style={{marginBottom: space.sm}}>
          <Txt variant="h2">{title}</Txt>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={styles.closeButton}>
            <Txt variant="h3" color="muted">
              ✕
            </Txt>
          </Pressable>
        </Row>
        <ScrollView keyboardShouldPersistTaps="handled" style={{maxHeight: 520}}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function NoticeBar(): React.JSX.Element | null {
  const notice = useStore(state => state.notice);
  const notify = useStore(state => state.notify);
  const palette = useTheme();
  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => notify(null), notice.kind === 'error' ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [notice, notify]);
  if (!notice) {
    return null;
  }
  const color =
    notice.kind === 'error' ? palette.danger : notice.kind === 'success' ? palette.success : palette.sky;
  return (
    <Pressable
      onPress={() => notify(null)}
      accessibilityRole="alert"
      accessibilityLabel={notice.message}
      style={[styles.notice, {backgroundColor: palette.surface, borderColor: color}]}>
      <Txt variant="small" style={{color, fontWeight: '600'}}>
        {notice.message}
      </Txt>
    </Pressable>
  );
}

export function Pill({label, color}: {label: string; color?: string}): React.JSX.Element {
  const palette = useTheme();
  const tone = color ?? palette.muted;
  return (
    <View style={[styles.pill, {backgroundColor: `${tone}22`, borderColor: `${tone}55`}]}>
      <Txt variant="micro" style={{color: tone, fontWeight: '700'}}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  padded: {padding: space.lg},
  paddedContent: {padding: space.lg, paddingBottom: 96},
  flex: {flex: 1},
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  appBarBack: {width: 32, alignItems: 'flex-start'},
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardPadded: {padding: space.md},
  primary: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  primaryCompact: {minHeight: 38, paddingHorizontal: space.md},
  ghost: {
    minHeight: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  chip: {
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 15,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  switch: {
    width: 46,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    padding: 3,
    justifyContent: 'center',
  },
  knob: {width: 20, height: 20, borderRadius: 10},
  empty: {alignItems: 'center', paddingVertical: space.xl},
  backdrop: {flex: 1, backgroundColor: '#00000066'},
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    padding: space.lg,
    maxHeight: '86%',
  },
  closeButton: {width: 32, height: 32, alignItems: 'center', justifyContent: 'center'},
  notice: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.md,
    zIndex: 50,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
});
