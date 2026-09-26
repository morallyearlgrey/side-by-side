import { Pressable, Text, View } from 'react-native';
import { Body, Section, Field, Label, Notice, Toggle, s } from '@/components/ui';
import type { ConversationRequest, EvidenceRequirement, Mode } from '@/lib/types';
import { colors } from '@/lib/theme';
import { canConfirmConversationRequest, currentConversationRequest } from './conversationRequest';

export function ConversationRequestFields({ request, mode, goal, onChange }: { request?: ConversationRequest | null; mode: Mode; goal: string; onChange: (value: ConversationRequest) => void }) {
  const current = currentConversationRequest(request, mode, goal);
  const requirement = current?.evidence_requirement;
  const update = (patch: Partial<EvidenceRequirement>) => onChange({ mode, goal, evidence_requirement: { version: 1, kind: 'unresolved', subject: null, claim: null, ...requirement, ...patch, confirmation: 'pending' } });
  const eligibleSubjects: [NonNullable<EvidenceRequirement['subject']>, string][] = mode === 'learn' ? [['candidate', 'The other person'], ['both', 'Both of us']] : mode === 'share' ? [['viewer', 'Me'], ['both', 'Both of us']] : [['candidate', 'The other person'], ['viewer', 'Me'], ['both', 'Both of us']];
  return <Section><Label>What would make this conversation useful?</Label><Body muted>For the goal and conversation style you selected above, does someone need to have done it before?</Body>
    <View style={{ gap: 10 }}>
      {([['none', 'Prior experience isn’t required'], ['firsthand', 'Prior experience matters']] as const).map(([kind, label]) => <Pressable key={kind} accessibilityRole="radio" accessibilityState={{ checked: requirement?.kind === kind }} onPress={() => update({ kind, subject: kind === 'none' ? null : mode === 'share' ? 'viewer' : 'candidate', claim: kind === 'none' ? null : '' })} style={[s.chip, requirement?.kind === kind && { backgroundColor: colors.action }]}><Text style={[s.chipText, requirement?.kind === kind && { color: 'white' }]}>{label}</Text></Pressable>)}
    </View>
    {requirement?.kind === 'firsthand' && <><Label>Who needs that experience?</Label><View style={s.chips}>{eligibleSubjects.map(([subject, label]) => <Pressable key={subject} accessibilityRole="radio" accessibilityState={{ checked: requirement.subject === subject }} onPress={() => update({ subject })} style={[s.chip, requirement.subject === subject && { backgroundColor: colors.action }]}><Text style={[s.chipText, requirement.subject === subject && { color: 'white' }]}>{label}</Text></Pressable>)}</View>
      <Field label="The experience they should be able to describe" value={requirement.claim || ''} maxLength={1000} placeholder="I have repaired a cracked canoe paddle blade." multiline onChangeText={claim => update({ claim })} />
      <Body muted>Write a specific “I have…” statement, including any result that matters to you. This checks what someone has told us; it doesn’t certify their expertise.</Body>
    </>}
    {!goal.trim() && <Notice>Add your goal in Something you’re exploring right now before confirming what you’re looking for.</Notice>}
    <Toggle title="This describes what I’m looking for" value={requirement?.confirmation === 'confirmed' && canConfirmConversationRequest(current)} disabled={!canConfirmConversationRequest(current)} onValueChange={confirmed => { if (current) onChange({ ...current, evidence_requirement: { ...current.evidence_requirement, confirmation: confirmed ? 'confirmed' : 'pending' } }); }} />
    {requirement?.confirmation !== 'confirmed' && <Notice>You can save your profile now. Matching needs you to choose and confirm what you’re looking for here.</Notice>}
  </Section>;
}
