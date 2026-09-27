import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Body, Button, Label, Notice, s } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMe } from '@/features/profile/useMe';
import { api, errorMessage } from '@/lib/api';
import { colors } from '@/lib/theme';
import type { ActivitySuggestion, MatchDescriptionResult, MatchTarget, Preview } from '@/lib/types';
import { activitySchedule, activitySourceUrl, currentActivitySuggestions } from './activityPresentation';
import { descriptionIdentity, matchDescriptionOptions, type DescriptionIdentity } from './matchDescriptionQuery';

export function ActivityCard({ item }: { item: ActivitySuggestion }) {
  const [linkError, setLinkError] = useState('');
  async function openSource() {
    setLinkError('');
    const url = activitySourceUrl(item.source_url);
    if (!url) { setLinkError('This activity link is unavailable.'); return; }
    try { await Linking.openURL(url); } catch { setLinkError('The source could not be opened. Please try again.'); }
  }
  return <View style={{ gap: 7, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line }}>
    <Label>{item.title}</Label>
    <Text style={s.small}>{item.invitation || item.summary}</Text>
    {!!item.reason && <Text style={s.small}>{item.reason}</Text>}
    <Text style={s.small}>{[item.venue, item.area, item.duration_minutes ? `About ${item.duration_minutes} min` : ''].filter(Boolean).join(' · ')}</Text>
    <Text style={s.small}>{activitySchedule(item)} · {item.cost_note || 'Check current prices'}</Text>
    {!!item.eligibility_note && <Text style={s.small}>{item.eligibility_note}</Text>}
    <Pressable accessibilityRole="link" accessibilityLabel={`View ${item.title} on ${item.source_name}`} onPress={() => void openSource()} style={[s.row, { minHeight: 44, gap: 7 }]}>
      <Ionicons name="open-outline" size={16} color={colors.violet} /><Text style={[s.small, { color: colors.violet, flexShrink: 1 }]}>{item.source_name} · Details</Text>
    </Pressable>
    {!!linkError && <Notice error>{linkError}</Notice>}
  </View>;
}

function CurrentMatchDescription({ identity }: { identity: DescriptionIdentity }) {
  const query = useQuery(matchDescriptionOptions(identity, ({ ownerId, target }, signal) =>
    api<MatchDescriptionResult>('/v1/matches/description', { method: 'POST', body: target, signal, expectedUserId: ownerId })));
  if (query.isPending) return <View style={[s.row, { gap: 10 }]}><ActivityIndicator accessibilityLabel="Preparing match ideas" color={colors.violet} /><Text style={[s.small, { flex: 1 }]}>Preparing a conversation starter and things to do together.</Text></View>;
  if (query.error) return <><Notice error>{errorMessage(query.error)}</Notice><Button title="Retry ideas" icon="refresh-outline" variant="quiet" onPress={() => void query.refetch()} /></>;
  if (query.data?.status !== 'ready') return <><Notice>{query.data?.message || 'Match ideas are unavailable.'}</Notice>{query.data?.status === 'error' && <Button title="Retry ideas" icon="refresh-outline" variant="quiet" onPress={() => void query.refetch()} />}</>;
  const result = query.data;
  const activities = currentActivitySuggestions(result.activities || []);
  return <View style={{ gap: 12 }}>
    <Text style={s.eyebrow}>{result.source === 'muse' ? 'Muse ideas' : 'Ideas for your match'}</Text>
    <Body>{result.description}</Body>
    <View style={{ gap: 8, borderLeftWidth: 2, borderLeftColor: colors.actionBorder, paddingLeft: 16, paddingVertical: 6 }}><Label>Conversation starter</Label><Body>{result.conversation_starter}</Body></View>
    <View style={{ gap: 4 }}><Label>Things to do together</Label>
      {activities.map(item => <ActivityCard key={item.id} item={item} />)}
      {!activities.length && <Text style={s.small}>{result.activities_message || 'No current activities fit this suggestion. Start with a conversation and choose something together.'}</Text>}
    </View>
    {!!activities.length && <Text style={s.small}>Choose together. Check the source for current hours, availability and entry requirements.</Text>}
  </View>;
}

export function MatchDescription({ target, preview }: { target: MatchTarget; preview: Preview }) {
  const { session } = useAuth(); const me = useMe();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => { const sub = AppState.addEventListener('change', state => setActive(state === 'active')); return () => sub.remove(); }, []);
  // Unmount the request observer on loss of its disclosure context. The query
  // signal cancels the last observer, and gcTime removes its sensitive text.
  if (!active || !session || me.isError || !me.data?.matching_consent || me.data.profile.user_id !== session.user.id || me.data.current_version?.profile_version_id !== target.viewer_version_id) return null;
  const identity = descriptionIdentity(session.user.id, target, me.data.preview, preview);
  if (!identity) return null;
  return <CurrentMatchDescription key={JSON.stringify(identity)} identity={identity} />;
}
