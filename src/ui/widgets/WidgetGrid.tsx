/**
 * Dashboard host: persists placement, span and per-widget config, and renders
 * each widget's real content. Reordering and resizing write to SQLite through
 * the store, so a restart restores the layout exactly.
 */
import React, {useMemo, useState} from 'react';
import {Alert, Pressable, StyleSheet, View} from 'react-native';
import {GhostButton, Row, Sheet, Txt, Chip, ToggleRow} from '../components';
import {radius, space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {WIDGET_CATALOG, widgetDefinition, widgetsByGroup, WIDGET_GROUPS} from './catalog';
import type {WidgetContext, WidgetDefinition, WidgetTarget} from './types';
import {WidgetEmpty} from './primitives';

export function WidgetGrid({
  onNavigate,
  openAssistant,
}: {
  onNavigate: (target: WidgetTarget, params?: Record<string, unknown>) => void;
  openAssistant: () => void;
}): React.JSX.Element {
  const palette = useTheme();
  const snapshot = useStore(state => state.snapshot);
  const settings = useStore(state => state.settings);
  const addWidget = useStore(state => state.addWidget);
  const removeWidget = useStore(state => state.removeWidget);
  const reorderWidgets = useStore(state => state.reorderWidgets);
  const resetWidgets = useStore(state => state.resetWidgets);
  const configureWidget = useStore(state => state.configureWidget);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [configFor, setConfigFor] = useState<{id: string; definition: WidgetDefinition; config: Record<string, unknown>} | null>(null);

  const placements = snapshot?.widgets ?? [];

  const context = useMemo<WidgetContext | null>(
    () =>
      snapshot
        ? {
            snapshot,
            settings,
            palette,
            config: {},
            navigate: onNavigate,
            openAssistant,
          }
        : null,
    [snapshot, settings, palette, onNavigate, openAssistant],
  );

  if (!snapshot || !context) {
    return (
      <View style={{padding: space.xl, alignItems: 'center'}}>
        <Txt variant="small" color="muted">
          Loading your dashboard…
        </Txt>
      </View>
    );
  }

  const move = async (index: number, delta: number): Promise<void> => {
    const next = [...placements];
    const target = index + delta;
    if (target < 0 || target >= next.length) {
      return;
    }
    const [item] = next.splice(index, 1);
    if (!item) {
      return;
    }
    next.splice(target, 0, item);
    await reorderWidgets(next.map(widget => ({kind: widget.kind, span: widget.span, config: widget.config})));
  };

  const resize = async (id: string): Promise<void> => {
    const next = placements.map(widget => ({
      kind: widget.kind,
      span: widget.id === id ? (widget.span === 2 ? 1 : 2) : widget.span,
      config: widget.config,
    }));
    await reorderWidgets(next);
  };

  const confirmRemove = (id: string, title: string): void => {
    Alert.alert('Remove widget', `Remove “${title}” from the dashboard?`, [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Remove', style: 'destructive', onPress: () => void removeWidget(id)},
    ]);
  };

  const confirmReset = (): void => {
    Alert.alert('Reset dashboard', 'Restore the default widget layout? Your widget settings will be lost.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Reset', style: 'destructive', onPress: () => void resetWidgets()},
    ]);
  };

  return (
    <View>
      <Row align="space-between" style={{marginBottom: space.sm}}>
        <Txt variant="h3">Dashboard</Txt>
        <Row gap={8}>
          <Pressable
            onPress={() => setEditing(value => !value)}
            accessibilityRole="button"
            accessibilityState={{selected: editing}}
            accessibilityLabel={editing ? 'Finish editing dashboard' : 'Edit dashboard'}
            style={[styles.toolButton, {borderColor: palette.line, backgroundColor: editing ? palette.ink : 'transparent'}]}>
            <Txt variant="micro" style={{color: editing ? palette.bg : palette.muted, fontWeight: '700'}}>
              {editing ? 'DONE' : 'EDIT'}
            </Txt>
          </Pressable>
          <Pressable
            onPress={() => setAddOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Add widget"
            style={[styles.toolButton, {borderColor: palette.line}]}>
            <Txt variant="micro" color="muted" style={{fontWeight: '700'}}>
              + ADD
            </Txt>
          </Pressable>
        </Row>
      </Row>

      {placements.length === 0 ? (
        <View style={{alignItems: 'center', paddingVertical: space.xl, gap: space.sm}}>
          <WidgetEmpty text="Your dashboard is empty." />
          <GhostButton label="Add widgets" onPress={() => setAddOpen(true)} />
        </View>
      ) : (
        <View style={styles.grid}>
          {placements.map((placement, index) => {
            const definition = widgetDefinition(placement.kind);
            if (!definition) {
              return (
                <View key={placement.id} style={[styles.cell, {width: '100%'}]}>
                  <View style={[styles.card, {backgroundColor: palette.surface, borderColor: palette.line}]}>
                    <Txt variant="small" color="muted">
                      Unknown widget “{placement.kind}”. Remove it in edit mode.
                    </Txt>
                  </View>
                </View>
              );
            }
            const config = normalizeConfig(definition, placement.config);
            return (
              <View key={placement.id} style={[styles.cell, {width: placement.span === 2 ? '100%' : '48.5%'}]}>
                <View
                  style={[
                    styles.card,
                    {
                      backgroundColor: palette.surface,
                      borderColor: editing ? palette.accent : palette.line,
                    },
                  ]}>
                  <View style={styles.cardHeader}>
                    <Txt variant="micro" color="muted" numberOfLines={1} style={{flex: 1, textTransform: 'uppercase'}}>
                      {definition.title}
                    </Txt>
                    {editing ? (
                      <Row gap={6}>
                        <SmallAction label="↑" accessibilityLabel={`Move ${definition.title} up`} onPress={() => void move(index, -1)} />
                        <SmallAction label="↓" accessibilityLabel={`Move ${definition.title} down`} onPress={() => void move(index, 1)} />
                        <SmallAction label={placement.span === 2 ? '½' : '⬒'} accessibilityLabel={`Resize ${definition.title}`} onPress={() => void resize(placement.id)} />
                        <SmallAction label="✕" accessibilityLabel={`Remove ${definition.title}`} onPress={() => confirmRemove(placement.id, definition.title)} />
                      </Row>
                    ) : definition.configFields.length > 0 ? (
                      <SmallAction
                        label="⚙"
                        accessibilityLabel={`Configure ${definition.title}`}
                        onPress={() => setConfigFor({id: placement.id, definition, config})}
                      />
                    ) : null}
                  </View>
                  <View style={{paddingHorizontal: space.md, paddingBottom: space.md}}>
                    {definition.render({...context, config})}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {editing ? (
        <View style={{marginTop: space.md}}>
          <GhostButton label="Reset to defaults" tone="muted" onPress={confirmReset} />
        </View>
      ) : null}

      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add a widget">
        <Txt variant="small" color="muted" style={{marginBottom: space.md}}>
          {WIDGET_CATALOG.length} widgets, all reading your local data.
        </Txt>
        {WIDGET_GROUPS.map(group => (
          <View key={group} style={{marginBottom: space.md}}>
            <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
              {group}
            </Txt>
            {widgetsByGroup(group).map(definition => (
              <Pressable
                key={definition.kind}
                onPress={() => {
                  void addWidget(definition.kind, definition.defaultSpan).then(() => setAddOpen(false));
                }}
                accessibilityRole="button"
                accessibilityLabel={`Add ${definition.title}`}
                style={[styles.addRow, {borderColor: palette.line}]}>
                <View style={{flex: 1}}>
                  <Txt variant="small" style={{fontWeight: '600'}}>
                    {definition.title}
                  </Txt>
                  <Txt variant="micro" color="faint">
                    {definition.description}
                  </Txt>
                </View>
                <Txt variant="small" color="accent">
                  +
                </Txt>
              </Pressable>
            ))}
          </View>
        ))}
      </Sheet>

      <Sheet
        visible={configFor !== null}
        onClose={() => setConfigFor(null)}
        title={configFor ? `Configure ${configFor.definition.title}` : 'Configure'}>
        {configFor ? (
          <WidgetConfigEditor
            definition={configFor.definition}
            config={configFor.config}
            onChange={async next => {
              await configureWidget(configFor.id, next);
              setConfigFor({...configFor, config: next});
            }}
          />
        ) : null}
      </Sheet>
    </View>
  );
}

function WidgetConfigEditor({
  definition,
  config,
  onChange,
}: {
  definition: WidgetDefinition;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => Promise<void>;
}): React.JSX.Element {
  return (
    <View>
      {definition.configFields.map(field => {
        if (field.type === 'select') {
          return (
            <View key={field.key} style={{marginBottom: space.md}}>
              <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
                {field.label}
              </Txt>
              <Row gap={6} style={{flexWrap: 'wrap'}}>
                {field.options.map(option => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    active={String(config[field.key] ?? field.options[0]?.value) === option.value}
                    onPress={() => void onChange({...config, [field.key]: option.value})}
                  />
                ))}
              </Row>
            </View>
          );
        }
        if (field.type === 'toggle') {
          return (
            <ToggleRow
              key={field.key}
              label={field.label}
              description={field.description}
              value={Boolean(config[field.key])}
              onPress={() => void onChange({...config, [field.key]: !config[field.key]})}
            />
          );
        }
        const value = typeof config[field.key] === 'number' ? (config[field.key] as number) : field.min;
        return (
          <View key={field.key} style={{marginBottom: space.md}}>
            <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
              {field.label}
            </Txt>
            <Row gap={8}>
              <GhostButton
                label="−"
                onPress={() => void onChange({...config, [field.key]: Math.max(field.min, value - 1)})}
              />
              <Txt variant="h3">{value}</Txt>
              <GhostButton
                label="+"
                onPress={() => void onChange({...config, [field.key]: Math.min(field.max, value + 1)})}
              />
            </Row>
          </View>
        );
      })}
    </View>
  );
}

function SmallAction({
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
      hitSlop={6}
      style={[styles.smallAction, {borderColor: palette.line}]}>
      <Txt variant="micro" color="muted">
        {label}
      </Txt>
    </Pressable>
  );
}

function normalizeConfig(
  definition: WidgetDefinition,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const config = {...raw};
  for (const field of definition.configFields) {
    if (field.type === 'number' && config[field.key] !== undefined) {
      const parsed = Number(config[field.key]);
      config[field.key] = Number.isFinite(parsed) ? parsed : field.min;
    }
    if (field.type === 'select' && config[field.key] !== undefined) {
      const parsed = Number(config[field.key]);
      config[field.key] = Number.isFinite(parsed) ? parsed : config[field.key];
    }
    if (field.type === 'toggle' && config[field.key] !== undefined) {
      config[field.key] = Boolean(config[field.key]);
    }
  }
  return config;
}

const styles = StyleSheet.create({
  grid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between'},
  cell: {marginBottom: space.sm},
  card: {borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden'},
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: 6,
    gap: 6,
    minHeight: 34,
  },
  toolButton: {borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5},
  smallAction: {
    minWidth: 26,
    minHeight: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    minHeight: 52,
  },
});
