import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Body, Card, Chips, Label, Notice, s } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { ConnectionMemory } from '@/lib/types';
import { colors } from '@/lib/theme';
import type { StarNode } from '@/features/constellation/geometry';
import { currentActivitySuggestions } from './activityPresentation';
import { ActivityCard } from './MatchDescription';
import { SavedConnectionControls } from './SavedConnectionControls';

export function SavedConnectionCard({ node, userId }: { node: StarNode; userId: string }) {
  const [expanded, setExpanded] = useState(false);
  const memory = useQuery({
    queryKey: ['connection-memory', userId, node.request_id],
    queryFn: ({ signal }) => api<ConnectionMemory>(`/v1/connections/${node.request_id}/memory`, {
      signal, expectedUserId: userId,
    }),
    enabled: expanded && node.display_name !== 'Past connection',
    staleTime: 0,
    retry: false,
  });
  const details = memory.data?.available ? memory.data : null;
  const ideas = details?.ideas?.status === 'ready' ? details.ideas : null;
  return <Card>
    <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? 'Hide' : 'Show'} saved details for ${node.display_name}`}
      accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}
      style={({ pressed }) => [s.panelHeader, pressed && { opacity: .7 }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}><Text style={s.eyebrow}>Past connection</Text><Text style={s.cardTitle}>{node.display_name}</Text></View>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.violet} />
    </Pressable>
    {expanded && <View style={{ gap: 14 }}>
      {node.display_name === 'Past connection' ? <Body muted>Shared details are hidden while this connection is unavailable.</Body>
        : memory.isPending ? <ActivityIndicator accessibilityLabel="Loading saved connection" color={colors.violet} />
        : memory.error ? <Notice error>Saved details are unavailable. {errorMessage(memory.error)}</Notice>
        : memory.data?.available === false ? <Body muted>This connection predates saved details. New accepted connections keep their approved information here.</Body>
        : details ? <>
          <Body muted>Saved when you both accepted. Later profile edits do not change this record.</Body>
          {!!details.preview.headline && <Body>{details.preview.headline}</Body>}
          {!!details.preview.occupation && <Text style={s.small}>{details.preview.occupation}</Text>}
          <Label>Their shared interests</Label><Chips values={details.preview.interests || []} />
          <Label>Interests you had in common</Label><Chips values={details.common_interests || []} />
          <Label>Traits and details they chose to share</Label>
          {details.facts.length ? details.facts.map((fact, index) => <View key={`${fact.topic}-${index}`} style={{ gap: 4 }}>
            <Text style={s.small}>{fact.topic} · {fact.relationship.replaceAll('_', ' ')}</Text>
            <Body>{fact.details}</Body>
          </View>) : <Body muted>No additional details were shared.</Body>}
          {ideas && <View style={{ gap: 10 }}>
            <Label>Saved conversation starter</Label><Body>{ideas.conversation_starter}</Body>
            <Label>Suggested things to do</Label>
            <Body muted>These ideas were saved when you viewed the connection. Check each source for current dates, availability and prices.</Body>
            {ideas.activities.map(item => <View key={item.id} style={{ gap: 3 }}>
              {!currentActivitySuggestions([item]).length && <Text style={s.small}>Past suggestion · details may have changed</Text>}
              <ActivityCard item={item} />
            </View>)}
            {!ideas.activities.length && <Body muted>No source backed events were available then.</Body>}
          </View>}
        </> : null}
      <SavedConnectionControls requestId={node.request_id} userId={userId} preference={node.preference} />
    </View>}
  </Card>;
}
