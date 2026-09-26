import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Button, Label, Notice, s } from '@/components/ui';
import type { Me } from '@/lib/types';
import { colors } from '@/lib/theme';
import { matchingReadiness } from './matchingReadiness';

export function ReadinessChecklist({ me, settings = false }: { me: Me; settings?: boolean }) {
  const readiness = matchingReadiness(me.current_version, me.profile.settings, me.preview, !!me.matching_consent);
  const model = me.readiness.matching as { available?: boolean } | undefined;
  return <View style={{ gap: 12 }}>
    <Label>{readiness.ready ? 'Your profile is ready for matching' : 'Before you meet people'}</Label>
    {!readiness.ready && readiness.checks.map(check => <View key={check.id} style={[s.row, { gap: 10 }]}>
      <Ionicons name={check.ready ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={check.ready ? colors.violet : colors.muted} />
      <Text style={[s.small, { flex: 1 }]}>{check.label}</Text>
    </View>)}
    {readiness.boundaryReview && <Notice>Matching is paused because this build cannot yet reliably filter your avoided topics. Your boundaries remain saved; you do not need to remove them.</Notice>}
    {model?.available === false && <Notice>The matching service is offline. Your profile is saved, but new AI matches cannot be generated yet.</Notice>}
    {!readiness.ready && !settings && <Button title="Review matching choices" variant="secondary" icon="options-outline" onPress={() => router.push('/(tabs)/settings')} />}
    {readiness.ready && <Text style={s.small}>Discovery stays off until you choose Nearby or Bluetooth Live. No charm or headset is required.</Text>}
  </View>;
}
