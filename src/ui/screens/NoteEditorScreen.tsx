/** Note editor, including the daily journal path. */
import React, {useEffect, useState} from 'react';
import {Alert, Pressable, ScrollView, View} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import {AppBar, Chip, Field, GhostButton, PrimaryButton, Row, Txt} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import {upsertJournal} from '../../repos/notes';
import type {RootStackParamList} from '../navigation';

export function NoteEditorScreen(): React.JSX.Element {
  const route = useRoute<RouteProp<RootStackParamList, 'NoteEditor'>>();
  const navigation = useNavigation();
  const palette = useTheme();
  const db = useStore(state => state.db);
  const snapshot = useStore(state => state.snapshot);
  const refresh = useStore(state => state.refresh);
  const saveNote = useStore(state => state.saveNote);
  const removeNote = useStore(state => state.removeNote);
  const settings = useStore(state => state.settings);
  const journalMode = route.params?.journal === true;
  const existing = snapshot?.notes.find(note => note.id === route.params?.id);
  const journalExisting = journalMode
    ? snapshot?.notes.find(note => note.journalDate === snapshot.todayKey)
    : undefined;
  const id = existing?.id ?? journalExisting?.id;

  const [title, setTitle] = useState(existing?.title ?? journalExisting?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? journalExisting?.body ?? '');
  const [tags, setTags] = useState((existing?.tags ?? []).join(', '));
  const [notebookId, setNotebookId] = useState<string | null>(existing?.notebookId ?? null);
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing) {
      setTitle(existing.title);
      setBody(existing.body);
      setTags(existing.tags.join(', '));
      setNotebookId(existing.notebookId);
      setPinned(existing.pinned);
    } else if (journalExisting) {
      setTitle(journalExisting.title);
      setBody(journalExisting.body);
    }
  }, [existing, journalExisting]);

  const save = async (): Promise<void> => {
    if (body.trim() === '' && title.trim() === '') {
      setError('Write something first.');
      return;
    }
    setBusy(true);
    try {
      if (journalMode && db) {
        await upsertJournal(db, snapshot?.todayKey ?? new Date().toISOString().slice(0, 10), body);
        await refresh();
      } else {
        await saveNote(
          {
            title,
            body,
            notebookId,
            tags: tags
              .split(',')
              .map(tag => tag.trim())
              .filter(tag => tag.length > 0),
            pinned,
          },
          id,
        );
      }
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The note could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (): void => {
    if (!id) {
      return;
    }
    Alert.alert('Delete note', 'The note will be removed. You can undo this.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void removeNote(id).then(() => navigation.goBack()),
      },
    ]);
  };

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <AppBar
        title={journalMode ? 'Journal' : id ? 'Edit note' : 'New note'}
        subtitle={journalMode ? settings.calendarTimeZone.replace(/_/g, ' ') : undefined}
        onBack={() => navigation.goBack()}
        right={
          id ? (
            <Pressable onPress={confirmDelete} accessibilityRole="button" accessibilityLabel="Delete note" hitSlop={8}>
              <Txt variant="small" color="danger">
                Delete
              </Txt>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={{padding: space.lg, paddingBottom: 48}} keyboardShouldPersistTaps="handled">
        {journalMode ? null : (
          <Field label="Title" value={title} onChangeText={setTitle} placeholder="Optional — first line is used" />
        )}
        <Field
          label={journalMode ? 'Today’s entry' : 'Note'}
          value={body}
          onChangeText={setBody}
          placeholder={journalMode ? 'What happened, what matters…' : 'Write freely…'}
          multiline
          autoFocus={!id}
          style={{minHeight: 220}}
        />

        {journalMode ? (
          <Txt variant="small" color="faint">
            Journal entries stay in your local database and are never uploaded.
          </Txt>
        ) : (
          <>
            <Field label="Tags (comma separated)" value={tags} onChangeText={setTags} placeholder="work, idea" />
            <Txt variant="micro" color="muted" style={{textTransform: 'uppercase', marginBottom: 6}}>
              Notebook
            </Txt>
            <Row gap={6} style={{flexWrap: 'wrap', marginBottom: space.md}}>
              <Chip label="None" active={notebookId === null} onPress={() => setNotebookId(null)} />
              {(snapshot?.notebooks ?? []).map(notebook => (
                <Chip
                  key={notebook.id}
                  label={notebook.name}
                  active={notebookId === notebook.id}
                  onPress={() => setNotebookId(notebook.id)}
                />
              ))}
            </Row>
            <GhostButton label={pinned ? 'Unpin note' : 'Pin note'} onPress={() => setPinned(value => !value)} />
          </>
        )}

        {error ? (
          <Txt variant="small" color="danger" style={{marginTop: space.md}}>
            {error}
          </Txt>
        ) : null}
        <View style={{marginTop: space.lg}}>
          <PrimaryButton label={busy ? 'Saving…' : 'Save note'} onPress={() => void save()} loading={busy} />
        </View>
      </ScrollView>
    </View>
  );
}
