/** Note widgets (33–38). */
import React, {useState} from 'react';
import {Pressable, TextInput, View} from 'react-native';
import {Txt} from '../components';
import {useTheme} from '../theme';
import {MiniList, WidgetEmpty} from './primitives';
import {journalNote, pinnedNotes, recentNotes} from './data';
import {useStore} from '../../state/store';
import {relativeDay} from '../format';
import type {WidgetContext} from './types';

function CaptureBox({
  placeholder,
  onSave,
  multiline,
  accessibilityLabel,
}: {
  placeholder: string;
  onSave: (text: string) => Promise<void>;
  multiline?: boolean;
  accessibilityLabel: string;
}): React.JSX.Element {
  const palette = useTheme();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <View style={{gap: 5}}>
      <TextInput
        value={value}
        onChangeText={text => {
          setValue(text);
          setSaved(false);
        }}
        placeholder={placeholder}
        placeholderTextColor={palette.faint}
        accessibilityLabel={accessibilityLabel}
        multiline={multiline}
        onSubmitEditing={() => {
          const trimmed = value.trim();
          if (trimmed === '') {
            return;
          }
          void onSave(trimmed).then(() => {
            setValue('');
            setSaved(true);
          });
        }}
        style={{
          borderWidth: 1,
          borderColor: palette.line,
          backgroundColor: palette.surfaceAlt,
          color: palette.ink,
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 8,
          minHeight: multiline ? 74 : 40,
          textAlignVertical: multiline ? 'top' : 'center',
          fontSize: 14,
        }}
      />
      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
        <Txt variant="micro" color={saved ? 'sage' : 'faint'}>
          {saved ? 'Saved locally' : 'Press return to save'}
        </Txt>
        <Pressable
          onPress={() => {
            const trimmed = value.trim();
            if (trimmed === '') {
              return;
            }
            void onSave(trimmed).then(() => {
              setValue('');
              setSaved(true);
            });
          }}
          accessibilityRole="button"
          accessibilityLabel="Save note"
          style={{paddingHorizontal: 10, paddingVertical: 4}}>
          <Txt variant="micro" color="accent" style={{fontWeight: '800'}}>
            SAVE
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

export function QuickNoteWidget(_ctx: WidgetContext): React.JSX.Element {
  const saveNote = useStore(state => state.saveNote);
  return (
    <CaptureBox
      placeholder="Jot a thought…"
      accessibilityLabel="Quick note text"
      multiline
      onSave={async text => {
        await saveNote({title: '', body: text, notebookId: null, tags: [], pinned: false});
      }}
    />
  );
}

export function PinnedNoteWidget(ctx: WidgetContext): React.JSX.Element {
  const notes = pinnedNotes(ctx.snapshot);
  if (notes.length === 0) {
    return <WidgetEmpty text="Pin a note to keep it here." actionLabel="Open notes" onAction={() => ctx.navigate('notes')} />;
  }
  const note = notes[0]!;
  return (
    <Pressable
      onPress={() => ctx.navigate('note', {id: note.id})}
      accessibilityRole="button"
      accessibilityLabel={`Open pinned note ${note.title}`}
      style={{gap: 3}}>
      <Txt variant="micro" color="plum" style={{textTransform: 'uppercase'}}>
        PINNED
      </Txt>
      <Txt variant="h3" numberOfLines={1}>
        {note.title}
      </Txt>
      <Txt variant="small" color="muted" numberOfLines={3}>
        {note.body.trim() || 'Empty note'}
      </Txt>
    </Pressable>
  );
}

export function RecentNotesWidget(ctx: WidgetContext): React.JSX.Element {
  const notes = recentNotes(ctx.snapshot, 5);
  if (notes.length === 0) {
    return <WidgetEmpty text="No notes yet." actionLabel="Write one" onAction={() => ctx.navigate('note', {})} />;
  }
  return (
    <MiniList
      items={notes.map(note => ({
        key: note.id,
        title: note.title,
        meta: relativeDay(note.updatedAt, ctx.snapshot.now, ctx.settings.calendarTimeZone),
        tone: ctx.palette.plum,
        onPress: () => ctx.navigate('note', {id: note.id}),
      }))}
    />
  );
}

export function NotesSearchWidget(ctx: WidgetContext): React.JSX.Element {
  const palette = useTheme();
  const search = useStore(state => state.search);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<{id: string; title: string; snippet: string}[] | null>(null);
  return (
    <View style={{gap: 6}}>
      <TextInput
        value={query}
        onChangeText={async text => {
          setQuery(text);
          if (text.trim().length < 2) {
            setHits(null);
            return;
          }
          const results = await search(text);
          setHits(
            results
              .filter(hit => hit.kind === 'note')
              .slice(0, 4)
              .map(hit => ({id: hit.id, title: hit.title, snippet: hit.snippet})),
          );
        }}
        placeholder="Search notes…"
        placeholderTextColor={palette.faint}
        accessibilityLabel="Search notes"
        style={{
          borderWidth: 1,
          borderColor: palette.line,
          backgroundColor: palette.surfaceAlt,
          color: palette.ink,
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 7,
          fontSize: 14,
        }}
      />
      {hits === null ? (
        <Txt variant="micro" color="faint">
          Type at least two letters.
        </Txt>
      ) : hits.length === 0 ? (
        <Txt variant="micro" color="faint">
          No matching notes.
        </Txt>
      ) : (
        <MiniList
          items={hits.map(hit => ({
            key: hit.id,
            title: hit.title,
            meta: undefined,
            tone: ctx.palette.plum,
            onPress: () => ctx.navigate('note', {id: hit.id}),
          }))}
        />
      )}
    </View>
  );
}

export function DailyJournalWidget(ctx: WidgetContext): React.JSX.Element {
  const note = journalNote(ctx.snapshot);
  if (!note) {
    return (
      <WidgetEmpty
        text="No entry for today."
        actionLabel="Write today's entry"
        onAction={() => ctx.navigate('notes', {journal: true})}
      />
    );
  }
  return (
    <Pressable
      onPress={() => ctx.navigate('note', {id: note.id})}
      accessibilityRole="button"
      accessibilityLabel="Open today's journal entry"
      style={{gap: 3}}>
      <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
        TODAY'S JOURNAL
      </Txt>
      <Txt variant="small" color="muted" numberOfLines={4}>
        {note.body.trim().slice(0, 220) || 'No words yet.'}
      </Txt>
      {note.tags.length > 0 ? (
        <Txt variant="micro" color="plum">
          {note.tags.join(' · ')}
        </Txt>
      ) : null}
    </Pressable>
  );
}

export function NotebookOverviewWidget(ctx: WidgetContext): React.JSX.Element {
  const notebooks = ctx.snapshot.notebooks;
  if (notebooks.length === 0) {
    return <WidgetEmpty text="No notebooks yet." actionLabel="Open notes" onAction={() => ctx.navigate('notes')} />;
  }
  return (
    <View style={{gap: 5}}>
      {notebooks.slice(0, 4).map(notebook => {
        const count = ctx.snapshot.notes.filter(note => note.notebookId === notebook.id).length;
        return (
          <Pressable
            key={notebook.id}
            onPress={() => ctx.navigate('notes', {notebookId: notebook.id})}
            accessibilityRole="button"
            accessibilityLabel={`${notebook.name}, ${count} notes`}
            style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
            <Txt variant="small" numberOfLines={1} style={{flex: 1}}>
              {notebook.name}
            </Txt>
            <Txt variant="micro" color="muted">
              {count}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

