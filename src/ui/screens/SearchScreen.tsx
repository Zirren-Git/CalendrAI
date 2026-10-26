/** Local search across events, tasks and notes. */
import React, {useEffect, useState} from 'react';
import {ScrollView, TextInput, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {AppBar, Card, EmptyState, Txt} from '../components';
import {space, useTheme} from '../theme';
import {useStore} from '../../state/store';
import type {SearchHit} from '../../domain/types';
import type {AppNavigation} from '../navigation';

const LABEL: Record<SearchHit['kind'], string> = {event: 'Event', task: 'Task', note: 'Note'};

export function SearchScreen(): React.JSX.Element {
  const navigation = useNavigation<AppNavigation>();
  const palette = useTheme();
  const search = useStore(state => state.search);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void search(query).then(results => {
        if (alive) {
          setHits(results);
        }
      });
    }, 160);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, search]);

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <AppBar title="Search" onBack={() => navigation.goBack()} />
      <View style={{padding: space.lg}}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Events, tasks, notes…"
          placeholderTextColor={palette.faint}
          accessibilityLabel="Search everything"
          autoFocus
          style={{
            borderWidth: 1,
            borderColor: palette.line,
            backgroundColor: palette.surfaceAlt,
            color: palette.ink,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 15,
          }}
        />
      </View>
      <ScrollView contentContainerStyle={{paddingHorizontal: space.lg, paddingBottom: 40}}>
        {hits === null ? (
          <Txt variant="small" color="faint">
            Type at least two letters. Search runs against the local database only.
          </Txt>
        ) : hits.length === 0 ? (
          <EmptyState title="No matches" message="Try a different word." glyph="⌕" />
        ) : (
          hits.map(hit => (
            <Card
              key={`${hit.kind}-${hit.id}`}
              style={{marginBottom: 8}}
              onPress={() => {
                if (hit.kind === 'event') {
                  navigation.navigate('EventEditor', {id: hit.id});
                } else if (hit.kind === 'task') {
                  navigation.navigate('TaskEditor', {id: hit.id});
                } else {
                  navigation.navigate('NoteEditor', {id: hit.id});
                }
              }}
              accessibilityLabel={`${LABEL[hit.kind]}: ${hit.title}`}>
              <Txt variant="micro" color="muted" style={{textTransform: 'uppercase'}}>
                {LABEL[hit.kind]}
              </Txt>
              <Txt variant="h3" numberOfLines={1}>
                {hit.title}
              </Txt>
              {hit.snippet ? (
                <Txt variant="small" color="muted" numberOfLines={2}>
                  {hit.snippet}
                </Txt>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}
