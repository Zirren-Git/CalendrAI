/**
 * Notes: search, notebooks, pinned notes and the daily journal. Notes are
 * plain text, stored locally; there is no rich-text dependency in this build.
 */
import React, {useMemo, useState} from 'react';
import {Pressable, ScrollView, View} from 'react-native';
import {Card, Chip, EmptyState, Field, GhostButton, Row, Sheet, Txt} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {relativeDay} from '../format';

export function NotesScreen({
  notebookId: initialNotebookId,
  onOpenNote,
  onNewNote,
}: {
  notebookId?: string;
  onOpenNote: (id: string) => void;
  onNewNote: (journal: boolean) => void;
}): React.JSX.Element {
  const palette = useTheme();
  const snapshot = useStore(state => state.snapshot);
  const settings = useStore(state => state.settings);
  const createNotebook = useStore(state => state.createNotebook);
  const togglePin = useStore(state => state.togglePin);
  const [query, setQuery] = useState('');
  const [notebookId, setNotebookId] = useState<string | undefined>(initialNotebookId);
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState('');

  const notes = useMemo(() => {
    const all = snapshot?.notes ?? [];
    const filtered = notebookId ? all.filter(note => note.notebookId === notebookId) : all;
    if (query.trim() === '') {
      return filtered;
    }
    const needle = query.toLowerCase();
    return filtered.filter(
      note =>
        note.title.toLowerCase().includes(needle) ||
        note.body.toLowerCase().includes(needle) ||
        note.tags.some(tag => tag.toLowerCase().includes(needle)),
    );
  }, [snapshot?.notes, notebookId, query]);

  if (!snapshot) {
    return <View style={{padding: space.lg}}><Txt variant="small" color="muted">Loading notes…</Txt></View>;
  }

  const journalToday = snapshot.notes.find(note => note.journalDate === snapshot.todayKey);
  const pinnedCount = notes.filter(note => note.pinned).length;

  return (
    <View style={{flex: 1}}>
      <ScrollView contentContainerStyle={{padding: space.lg, paddingBottom: 120}} keyboardShouldPersistTaps="handled">
        <Txt variant="h1">Notes</Txt>
        <Txt variant="small" color="muted">
          {snapshot.notes.length} notes · {pinnedCount} pinned
        </Txt>

        <Field
          placeholder="Search notes…"
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Search notes"
          style={{marginTop: space.md}}
        />

        <Row gap={6} style={{flexWrap: 'wrap', marginBottom: space.sm}}>
          <Chip label="ALL" active={!notebookId} onPress={() => setNotebookId(undefined)} />
          {snapshot.notebooks.map(notebook => (
            <Chip
              key={notebook.id}
              label={notebook.name}
              active={notebookId === notebook.id}
              onPress={() => setNotebookId(notebook.id)}
            />
          ))}
          <Pressable onPress={() => setSheet(true)} accessibilityRole="button" accessibilityLabel="New notebook">
            <Txt variant="small" color="accent">
              + notebook
            </Txt>
          </Pressable>
        </Row>

        <Row gap={8} style={{marginBottom: space.md}}>
          <GhostButton label="New note" onPress={() => onNewNote(false)} />
          <GhostButton label={journalToday ? 'Open journal' : 'Write journal'} onPress={() => onNewNote(true)} />
        </Row>

        {notes.length === 0 ? (
          <EmptyState
            title={query ? 'No matches' : 'No notes yet'}
            message={query ? 'Try another word.' : 'Capture a thought, a meeting note or today’s journal.'}
            actionLabel="New note"
            onAction={() => onNewNote(false)}
            glyph="✎"
          />
        ) : (
          notes.map(note => (
            <Card
              key={note.id}
              style={{marginBottom: 8}}
              onPress={() => onOpenNote(note.id)}
              accentColor={note.pinned ? palette.plum : undefined}
              accessibilityLabel={`Open note ${note.title}`}>
              <Row align="space-between">
                <Txt variant="h3" numberOfLines={1} style={{flex: 1}}>
                  {note.pinned ? '📌 ' : ''}
                  {note.title}
                </Txt>
                <Pressable
                  onPress={() => void togglePin(note)}
                  accessibilityRole="button"
                  accessibilityLabel={note.pinned ? 'Unpin note' : 'Pin note'}
                  hitSlop={8}>
                  <Txt variant="small" color={note.pinned ? 'plum' : 'faint'}>
                    {note.pinned ? '★' : '☆'}
                  </Txt>
                </Pressable>
              </Row>
              <Txt variant="small" color="muted" numberOfLines={2}>
                {note.body.trim() || 'Empty note'}
              </Txt>
              <Txt variant="micro" color="faint" style={{marginTop: 4}}>
                {relativeDay(note.updatedAt, snapshot.now, settings.calendarTimeZone)}
                {note.tags.length > 0 ? ` · ${note.tags.join(' · ')}` : ''}
              </Txt>
            </Card>
          ))
        )}
      </ScrollView>

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="New notebook">
        <Field label="Name" value={name} onChangeText={setName} placeholder="Work journal" autoFocus />
        <GhostButton
          label="Create notebook"
          onPress={() => {
            const trimmed = name.trim();
            if (trimmed === '') {
              return;
            }
            void createNotebook(trimmed).then(() => {
              setName('');
              setSheet(false);
            });
          }}
        />
      </Sheet>
    </View>
  );
}

