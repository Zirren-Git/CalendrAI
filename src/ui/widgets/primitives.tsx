/** Small building blocks shared by the 48 dashboard widgets. */
import React, {type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Txt} from '../components';
import {radius, space, useTheme, readableOn} from '../theme';

export function WidgetEmpty({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element {
  const palette = useTheme();
  return (
    <View style={styles.empty}>
      <Txt variant="small" color="faint" align="center">
        {text}
      </Txt>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" accessibilityLabel={actionLabel} hitSlop={8}>
          <Txt variant="small" color="accent" style={{marginTop: 4, fontWeight: '600'}}>
            {actionLabel}
          </Txt>
        </Pressable>
      ) : null}
      <View style={{height: 2, backgroundColor: palette.line, width: 24, marginTop: 8, borderRadius: 1}} />
    </View>
  );
}

export function MiniList({
  items,
}: {
  items: {
    key: string;
    title: string;
    meta?: string;
    tone?: string;
    done?: boolean;
    onPress?: () => void;
    accessibilityLabel?: string;
  }[];
}): React.JSX.Element {
  const palette = useTheme();
  return (
    <View style={{gap: 2}}>
      {items.map(item => (
        <Pressable
          key={item.key}
          onPress={item.onPress}
          disabled={!item.onPress}
          accessibilityRole={item.onPress ? 'button' : undefined}
          accessibilityLabel={item.accessibilityLabel ?? `${item.title}${item.meta ? `, ${item.meta}` : ''}`}
          style={({pressed}) => [styles.miniRow, pressed ? {opacity: 0.7} : null]}>
          <View style={[styles.dot, {backgroundColor: item.tone ?? palette.line}]} />
          <Txt
            variant="small"
            numberOfLines={1}
            style={{flex: 1, textDecorationLine: item.done ? 'line-through' : 'none', color: item.done ? palette.faint : palette.ink}}>
            {item.title}
          </Txt>
          {item.meta ? (
            <Txt variant="micro" color="muted" numberOfLines={1}>
              {item.meta}
            </Txt>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

export function Stat({
  value,
  label,
  hint,
  color,
}: {
  value: string;
  label: string;
  hint?: string;
  color?: string;
}): React.JSX.Element {
  const palette = useTheme();
  return (
    <View style={{gap: 2}}>
      <Txt variant="h1" style={{color: color ?? palette.ink}}>
        {value}
      </Txt>
      <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
        {label}
      </Txt>
      {hint ? (
        <Txt variant="small" color="faint">
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

export function Bars({
  values,
  color,
  labels,
  accessibilityLabel,
}: {
  values: number[];
  color?: string;
  labels?: string[];
  accessibilityLabel?: string;
}): React.JSX.Element {
  const palette = useTheme();
  const max = Math.max(1, ...values);
  return (
    <View
      style={styles.bars}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? 'Bar chart'}>
      {values.map((value, index) => (
        <View key={index} style={styles.barColumn}>
          <View
            style={{
              height: Math.max(3, Math.round((value / max) * 42)),
              backgroundColor: value === 0 ? palette.surfaceAlt : (color ?? palette.sage),
              borderRadius: 3,
              width: '100%',
            }}
          />
          {labels?.[index] ? (
            <Txt variant="micro" color="faint" style={{marginTop: 2}}>
              {labels[index]}
            </Txt>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function Ring({
  progress,
  label,
  caption,
  color,
  size = 76,
}: {
  progress: number;
  label: string;
  caption?: string;
  color?: string;
  size?: number;
}): React.JSX.Element {
  const palette = useTheme();
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: space.md}}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={caption ?? label}
        accessibilityValue={{min: 0, max: 100, now: Math.round(pct * 100)}}
        style={[
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: palette.surfaceAlt,
            borderTopColor: color ?? palette.accent,
            borderRightColor: pct > 0.25 ? (color ?? palette.accent) : palette.surfaceAlt,
            borderBottomColor: pct > 0.55 ? (color ?? palette.accent) : palette.surfaceAlt,
            borderLeftColor: pct > 0.8 ? (color ?? palette.accent) : palette.surfaceAlt,
          },
        ]}>
        <Txt variant="h3">{label}</Txt>
      </View>
      {caption ? (
        <Txt variant="small" color="muted" style={{flex: 1}}>
          {caption}
        </Txt>
      ) : null}
    </View>
  );
}

export function ColorBlock({color, children}: {color: string; children: ReactNode}): React.JSX.Element {
  return (
    <View
      style={[
        styles.block,
        {backgroundColor: color, borderColor: `${readableOn(color)}22`},
      ]}>
      {children}
    </View>
  );
}

export function KeyValue({left, right, tone}: {left: string; right: string; tone?: string}): React.JSX.Element {
  const palette = useTheme();
  return (
    <View style={styles.keyValue}>
      <Txt variant="small" color="muted">
        {left}
      </Txt>
      <Txt variant="small" style={{color: tone ?? palette.ink, fontWeight: '600'}}>
        {right}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {alignItems: 'center', paddingVertical: space.sm},
  miniRow: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, minHeight: 30},
  dot: {width: 7, height: 7, borderRadius: 4},
  bars: {flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 62},
  barColumn: {flex: 1, alignItems: 'center', justifyContent: 'flex-end'},
  ring: {borderWidth: 7, alignItems: 'center', justifyContent: 'center'},
  block: {borderRadius: radius.md, borderWidth: 1, padding: space.md},
  keyValue: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3},
});
