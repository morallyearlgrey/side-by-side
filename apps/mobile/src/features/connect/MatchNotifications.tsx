import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Body, Button, Card, Chips, Notice, s } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { colors } from '@/lib/theme';
import { api, errorMessage } from '@/lib/api';
import type { Discovery, MatchTarget } from '@/lib/types';
import { useDiscovery } from './DiscoveryProvider';
import { MatchPreference } from './MatchPreference';
import { MatchDescription } from './MatchDescription';

export const discoveryTarget = (item: Discovery): MatchTarget => ({ candidate_id: item.candidate_id,
  viewer_version_id: item.viewer_version_id, candidate_version_id: item.candidate_version_id, mode: item.mode });

function PopupCard({ item, close }: { item: Discovery; close: () => void }) {
  const { session } = useAuth(); const client = useQueryClient(); const target = discoveryTarget(item);
  const invite = useMutation({ mutationFn: () => api('/v1/connections', { method: 'POST', expectedUserId: session?.user.id,
    body: { candidate_id: item.candidate_id, mode: item.mode } }), onSuccess: () => void client.invalidateQueries({ queryKey: ['connections'] }) });
  return <Card><Text accessibilityRole="header" style={s.cardTitle}>{item.preview.display_name}</Text>
    <Text style={s.eyebrow}>New suggestion</Text><Chips values={item.preview.interests} />
    <MatchDescription target={target} preview={item.preview} />
    <MatchPreference target={target} preference={item.preference} />
    <Body muted>Your rating is private. It does not accept an invitation, record a conversation, or enable sharing.</Body>
    {invite.isSuccess ? <Notice>Invitation saved in Matches.</Notice> : <Button title="Send invitation" icon="chatbubble-outline" variant="secondary" loading={invite.isPending} onPress={() => invite.mutate()} />}
    {invite.error && <Notice error>{errorMessage(invite.error)}</Notice>}
    <Button title="Close match" icon="close" variant="quiet" onPress={close} />
  </Card>;
}
export function MatchNotifications() {
  const discovery = useDiscovery(); const insets = useSafeAreaInsets();
  if (!discovery) return null;
  const { banner, popup } = discovery;
  const notification = banner && <View accessibilityLiveRegion="polite" style={{ position: 'absolute', top: insets.top + 8, left: 20, right: 20, alignItems: 'center', zIndex: 2 }}>
    <View style={{ backgroundColor: colors.lavender, borderRadius: 16, padding: 16, width: '100%', maxWidth: 550, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Ionicons name="chatbubble-outline" size={22} color="white" />
      <Pressable style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={`View new match with ${banner.preview.display_name}`} onPress={() => discovery.open(banner.event_key)}><Text style={{ color: 'white', fontWeight: '600' }}>New match suggestion: {banner.preview.display_name}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notification" hitSlop={12} onPress={discovery.dismissBanner}><Ionicons name="close" size={22} color="white" /></Pressable>
    </View>
  </View>;
  return <>{!popup && notification}{popup && <Modal transparent animationType="fade" visible onRequestClose={discovery.dismissPopup}>
    <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: '#00000055' }}>
      {notification}
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingTop: insets.top + 110, paddingBottom: insets.bottom + 24 }}>
        <View style={{ width: '100%', maxWidth: 550, alignSelf: 'center' }}><PopupCard key={popup.event_key} item={popup} close={discovery.dismissPopup} /></View>
      </ScrollView>
    </View>
  </Modal>}</>;
}
