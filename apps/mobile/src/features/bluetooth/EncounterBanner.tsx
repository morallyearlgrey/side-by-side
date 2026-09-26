import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBluetooth } from './BluetoothProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { colors } from '@/lib/theme';
import { recommendedEncounters } from '@/features/nearby/matchingDecision';
import { ConversationDetails } from './ConversationDetails';

type ShownEncounter = { ownerId: string; candidateId: string };
const BANNER_DURATION_MS = 120_000;

export function EncounterBanner() {
  const { encounters, state } = useBluetooth();
  const { session } = useAuth();
  const ownerId = session?.user.id;
  const [shown, setShown] = useState<ShownEncounter | null>(null);
  const seen = useRef<{ ownerId?: string; candidates: Set<string> }>({ candidates: new Set() });
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!state.live || !ownerId) {
      setShown(null);
      seen.current = { ownerId, candidates: new Set() };
      return;
    }
    if (seen.current.ownerId !== ownerId) seen.current = { ownerId, candidates: new Set() };
    const recommended = recommendedEncounters(encounters);
    if (shown?.ownerId === ownerId && recommended.some(item => item.candidate_id === shown.candidateId)) return;
    const next = recommended.find(item => !seen.current.candidates.has(item.candidate_id!));
    if (next?.candidate_id) {
      seen.current.candidates.add(next.candidate_id);
      setShown({ ownerId, candidateId: next.candidate_id });
    } else if (shown) setShown(null);
  }, [encounters, ownerId, shown, state.live]);

  const shownOwner = shown?.ownerId;
  const shownCandidate = shown?.candidateId;
  useEffect(() => {
    if (!shownOwner || !shownCandidate) return;
    const timer = setTimeout(() => setShown(null), BANNER_DURATION_MS);
    return () => clearTimeout(timer);
  }, [shownOwner, shownCandidate]);

  // New suggestions never restart the timer; fresh radio observations may keep
  // the encounter current, but revocation, expiry, and Live off always hide it.
  const current = shownOwner === ownerId ? recommendedEncounters(encounters).find(item => item.candidate_id === shownCandidate) : undefined;
  if (!current?.preview || !state.live) return null;
  const openBluetooth = () => { setShown(null); router.push('/(tabs)/bluetooth'); };
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 20, right: 20, bottom: insets.bottom + 75, alignItems: 'center' }}>
    <View style={{ width: '100%', maxWidth: 550, borderRadius: 8, borderWidth: 1, borderColor: colors.actionBorder, padding: 18, backgroundColor: colors.surface, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Ionicons name="sparkles-outline" size={24} color={colors.accent} />
        <Pressable accessibilityRole="button" accessibilityLabel={`See ${current.preview.display_name} in Bluetooth`} style={{ flex: 1, gap: 3 }} onPress={openBluetooth}>
          <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>{current.preview.display_name} is nearby</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>View in Bluetooth</Text>
        </Pressable>
        <Pressable onPress={() => setShown(null)} accessibilityRole="button" accessibilityLabel="Dismiss nearby invitation" hitSlop={12}>
          <Ionicons name="close" size={22} color="white" />
        </Pressable>
      </View>
      {current.conversation_context ? <ScrollView style={{ maxHeight: 300 }}>
        <ConversationDetails candidateId={current.candidate_id!} inverted />
      </ScrollView> : <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>Your current conversation requests look like a good fit.</Text>}
    </View>
  </View>;
}
