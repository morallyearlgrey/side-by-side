import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Body, Button, Card, Chips, s } from '@/components/ui';
import { colors } from '@/lib/theme';
import type { Discovery, MatchTarget } from '@/lib/types';
import { useDiscovery } from './DiscoveryProvider';

export const discoveryTarget = (item: Discovery): MatchTarget => ({ candidate_id: item.candidate_id,
  viewer_version_id: item.viewer_version_id, candidate_version_id: item.candidate_version_id, mode: item.mode });

function PopupCard({ item, close }: { item: Discovery; close: () => void }) {
  return <Card style={{ borderColor: '#FF6D2999', backgroundColor: 'rgba(36,25,27,.94)', shadowColor: colors.violet, shadowOpacity: .35, shadowRadius: 24 }}>
    <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={s.eyebrow}>A new connection is nearby</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss suggestion" hitSlop={14} onPress={close} style={{ padding: 8 }}><Ionicons name="close" size={24} color={colors.ink} /></Pressable></View>
    <Text accessibilityRole="header" style={[s.cardTitle, { fontSize: 26, lineHeight: 34 }]}>{item.preview.display_name}</Text>
    <Chips values={item.preview.interests} />
    <Body muted>{item.preview.display_name} may be someone you would enjoy talking with. Explore their approved interests and a conversation idea in Connect.</Body>
    <Button title="Interested · View in Connect" icon="arrow-forward" onPress={() => { close(); router.push('/(tabs)/connect'); }} />
    <Text style={s.small}>This suggestion closes in 10 seconds.</Text>
  </Card>;
}
export function MatchNotifications() {
  const discovery = useDiscovery(); const insets = useSafeAreaInsets();
  if (!discovery) return null;
  const { banner, popup } = discovery;
  const notification = banner && <View accessibilityLiveRegion="polite" style={{ position: 'absolute', top: insets.top + 8, left: 20, right: 20, alignItems: 'center', zIndex: 2 }}>
    <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.actionBorder, borderRadius: 8, padding: 12, width: '100%', maxWidth: 550, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Ionicons name="chatbubble-outline" size={22} color="white" />
      <Pressable style={{ flex: 1, minHeight: 44, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel={`View new match with ${banner.preview.display_name}`} onPress={() => discovery.open(banner.event_key)}><Text style={{ color: colors.ink, fontWeight: '500', lineHeight: 21 }}>New match suggestion: {banner.preview.display_name}</Text></Pressable>
      <Pressable style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Dismiss notification" hitSlop={12} onPress={discovery.dismissBanner}><Ionicons name="close" size={22} color="white" /></Pressable>
    </View>
  </View>;
  return <>{!popup && notification}{popup && <Modal transparent animationType="fade" visible onRequestClose={discovery.dismissPopup}>
    <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: '#0C1014D9' }}>
      {notification}
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingTop: insets.top + 110, paddingBottom: insets.bottom + 24 }}>
        <View style={{ width: '100%', maxWidth: 550, alignSelf: 'center' }}><PopupCard key={popup.event_key} item={popup} close={discovery.dismissPopup} /></View>
      </ScrollView>
    </View>
  </Modal>}</>;
}
