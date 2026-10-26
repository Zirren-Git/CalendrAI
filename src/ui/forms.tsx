/**
 * Date and time controls.
 *
 * Deliberately dependency-free: a date stepper plus quick chips is faster to
 * use one-handed than a modal wheel, and it works with TalkBack out of the box.
 */
import React from 'react';
import {Pressable, View} from 'react-native';
import {Txt} from './components';
import {space, useTheme} from './theme';
import {addDaysToDateKey, formatTime, localDateKey, parseDateKey, wallClockToUtc, zonedParts} from '../domain/time';
import {MONTH_SHORT, WEEKDAY_SHORT} from './format';

function Step({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}): React.JSX.Element {
  const palette = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: palette.line,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Txt variant="h3" color="muted">
        {label}
      </Txt>
    </Pressable>
  );
}

export function DateTimeField({
  label,
  value,
  onChange,
  timeZone,
  clock24h,
  allDay,
  error,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  timeZone: string;
  clock24h: boolean;
  allDay?: boolean;
  error?: string | null;
}): React.JSX.Element {
  const palette = useTheme();
  const parts = zonedParts(value, timeZone);
  const key = localDateKey(value, timeZone);
  const shiftDay = (days: number): void =>
    onChange(wallClockToUtc({...parts, day: parts.day + days}, timeZone));
  const shiftMinutes = (minutes: number): void => {
    const next = zonedParts(value + minutes * 60_000, timeZone);
    onChange(wallClockToUtc({year: next.year, month: next.month, day: next.day, hour: next.hour, minute: next.minute}, timeZone));
  };
  return (
    <View style={{marginBottom: space.md}}>
      <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
        {label}
      </Txt>
      <View
        style={{
          borderWidth: 1,
          borderColor: error ? palette.danger : palette.line,
          borderRadius: 12,
          padding: space.sm,
          gap: space.sm,
          backgroundColor: palette.surfaceAlt,
        }}>
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
          <Step label="‹" onPress={() => shiftDay(-1)} accessibilityLabel={`${label}: previous day`} />
          <View style={{alignItems: 'center'}}>
            <Txt variant="h3">
              {WEEKDAY_SHORT[new Date(`${key}T12:00:00Z`).getUTCDay()]} {parts.day} {MONTH_SHORT[parts.month - 1]}
            </Txt>
            <Txt variant="micro" color="faint">
              {parts.year}
            </Txt>
          </View>
          <Step label="›" onPress={() => shiftDay(1)} accessibilityLabel={`${label}: next day`} />
        </View>
        <View style={{flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center'}}>
          {[
            {label: 'Today', offset: 0},
            {label: 'Tomorrow', offset: 1},
            {label: 'Next week', offset: 7},
          ].map(option => {
            const targetKey = addDaysToDateKey(localDateKey(Date.now(), timeZone), option.offset);
            const active = targetKey === key;
            return (
              <Pressable
                key={option.label}
                onPress={() => {
                  const target = parseDateKey(targetKey);
                  onChange(
                    wallClockToUtc(
                      {year: target.year, month: target.month, day: target.day, hour: parts.hour, minute: parts.minute},
                      timeZone,
                    ),
                  );
                }}
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${option.label}`}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? palette.ink : palette.line,
                  backgroundColor: active ? palette.ink : 'transparent',
                }}>
                <Txt variant="micro" style={{color: active ? palette.bg : palette.muted}}>
                  {option.label}
                </Txt>
              </Pressable>
            );
          })}
        </View>
        {allDay ? null : (
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md}}>
            <Step label="−" onPress={() => shiftMinutes(-15)} accessibilityLabel={`${label}: earlier`} />
            <Txt variant="h2">{formatTime(value, timeZone, clock24h)}</Txt>
            <Step label="+" onPress={() => shiftMinutes(15)} accessibilityLabel={`${label}: later`} />
          </View>
        )}
      </View>
      {error ? (
        <Txt variant="small" color="danger" style={{marginTop: 4}}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: {value: T; label: string}[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}): React.JSX.Element {
  const palette = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{flexDirection: 'row', gap: 6, flexWrap: 'wrap'}}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{selected: active}}
            accessibilityLabel={option.label}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 7,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? palette.ink : palette.line,
              backgroundColor: active ? palette.ink : 'transparent',
              minHeight: 34,
              justifyContent: 'center',
            }}>
            <Txt variant="micro" style={{color: active ? palette.bg : palette.muted, fontWeight: '600'}}>
              {option.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
