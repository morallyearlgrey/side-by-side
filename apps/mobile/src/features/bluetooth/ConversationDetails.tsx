import { ActivityIndicator, Text, View } from 'react-native';
import { colors } from '@/lib/theme';
import { useConversationIdea } from './useConversationIdea';

export function ConversationDetails({ candidateId, inverted = false }: { candidateId: string; inverted?: boolean }) {
  const { context, idea, loading, unavailable } = useConversationIdea(candidateId);
  if (!context) return null;
  const text = inverted ? '#FFFFFF' : colors.ink;
  const muted = inverted ? colors.violetDark : colors.muted;
  return <View style={{ gap: 12 }}>
    <View style={{ gap: 4 }}>
      <Text style={{ color: muted, fontSize: 12, fontWeight: '600' }}>Why you might connect</Text>
      <Text style={{ color: text, fontSize: 14, lineHeight: 21 }}>{context.reason}</Text>
    </View>
    {loading && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <ActivityIndicator size="small" color={muted} />
      <Text style={{ color: muted, fontSize: 12, lineHeight: 18, flex: 1 }}>Finding a conversation idea…</Text>
    </View>}
    {idea && <View accessibilityLiveRegion="polite" style={{ gap: 4 }}>
      <Text style={{ color: muted, fontSize: 12, fontWeight: '600' }}>{idea.source === 'muse' ? 'Muse suggests' : 'Simple conversation starter'}</Text>
      <Text style={{ color: text, fontSize: 15, lineHeight: 23 }}>“{idea.opener}”</Text>
    </View>}
    {unavailable && <Text style={{ color: muted, fontSize: 12, lineHeight: 18 }}>Conversation idea unavailable right now. You can still say hello.</Text>}
  </View>;
}
