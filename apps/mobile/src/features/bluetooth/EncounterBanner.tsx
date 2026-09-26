import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBluetooth } from './BluetoothProvider';
import type { Encounter } from '@/lib/types';
import { colors } from '@/lib/theme';

export function EncounterBanner() {
  const { encounters, state } = useBluetooth(); const [shown, setShown] = useState<Encounter | null>(null);
  const seen = useRef(new Set<string>()); const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!state.live) { setShown(null); seen.current.clear(); return; }
    const next = encounters.find(e => e.status === 'scored' && e.candidate_id && e.preview && !seen.current.has(e.candidate_id));
    if (next?.candidate_id) { seen.current.add(next.candidate_id); setShown(next); }
  }, [encounters, state.live]);
  useEffect(() => { if (!shown) return; const timer = setTimeout(() => setShown(null), 9000); return () => clearTimeout(timer); }, [shown]);
  if (!shown?.preview || !state.live) return null;
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 20, right: 20, bottom: insets.bottom + 75, alignItems: 'center' }}><View accessibilityLiveRegion="polite" style={{ width: '100%', maxWidth: 550, borderRadius: 22, padding: 18, backgroundColor: colors.violetDark, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
    <Ionicons name="sparkles-outline" size={24} color="#E0D8FF" /><Pressable accessibilityRole="button" accessibilityLabel={`See ${shown.preview.display_name} in Bluetooth`} style={{ flex: 1, gap: 4 }} onPress={() => { setShown(null); router.push('/(tabs)/bluetooth'); }}><Text style={{ color: 'white', fontSize: 15, fontWeight: '600' }}>{shown.preview.display_name} is nearby</Text><Text style={{ color: '#DDD4F5', fontSize: 12 }}>You might have something to talk about. Take a look.</Text></Pressable><Pressable onPress={() => setShown(null)} accessibilityRole="button" accessibilityLabel="Dismiss nearby invitation" hitSlop={12}><Ionicons name="close" size={22} color="white" /></Pressable>
  </View></View>;
}
