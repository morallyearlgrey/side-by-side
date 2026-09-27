import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Body, Button, Section, Field, Label, Notice, Toggle, s } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { colors } from '@/lib/theme';
import { emptyDraft, emptySettings, type Fact, type Gender, type Mode, type Preview, type ProfileDraft, type ReviewRequest, type UserSettings } from '@/lib/types';
import { ConversationRequestFields } from './ConversationRequestFields';
import { changeConversationGoal, currentConversationRequest } from './conversationRequest';
import { approvedDetail, profileSettingsForSave, unmatchedTopics } from './matchingDetails';
import { requiredProfileDetails } from './requiredProfileDetails';

const modes: [Mode, string][] = [['casual_chat', 'A good conversation'], ['learn', 'Learn something'], ['share', 'Share what I know'], ['exchange_stories', 'Swap stories'], ['collaborate', 'Make something'], ['find_activity_partner', 'Do something together']];
const genders: [Gender, string][] = [['woman', 'Women'], ['man', 'Men'], ['nonbinary', 'Nonbinary people'], ['another_gender', 'Another gender'], ['undisclosed', 'People who prefer not to say']];
const identityLabels: Record<Gender, string> = { woman: 'Woman', man: 'Man', nonbinary: 'Nonbinary', another_gender: 'Another gender', undisclosed: 'Prefer not to say' };
export const splitList = (text: string) => [...new Set(text.split(',').map(x => x.trim()).filter(Boolean))];
function ListField({ label, values, onChange, placeholder }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(values.join(', '));
  return <Field label={label} value={text} placeholder={placeholder || 'Separate with commas'} onChangeText={v => { setText(v); onChange(splitList(v)); }} />;
}
export function ProfileForm({ initialDraft, initialSettings, initialPreview, onSave, saving, error, onboarding = false, showPreview = true }: { initialDraft?: ProfileDraft | null; initialSettings?: UserSettings; initialPreview?: Preview | null; onSave: (data: ReviewRequest) => void; saving: boolean; error?: string; onboarding?: boolean; showPreview?: boolean }) {
  const [draft, setDraft] = useState<ProfileDraft>({ current_goal: initialDraft?.current_goal || '', conversation_intent: initialDraft?.conversation_intent ?? null, facts: initialDraft?.facts || emptyDraft.facts, open_to_discussing: initialDraft?.open_to_discussing || [], conversation_preferences: initialDraft?.conversation_preferences || [], avoid_topics: initialDraft?.avoid_topics || [], conversation_request: initialDraft?.conversation_request ?? null });
  const [settings, setSettings] = useState<UserSettings>({ ...emptySettings, ...initialSettings, gender_preferences: initialSettings?.gender_preferences ?? [] });
  const [preview, setPreview] = useState<Preview>(initialPreview || { enabled: false, display_name: '', interests: [] });
  const [topic, setTopic] = useState(''); const [details, setDetails] = useState(''); const [role, setRole] = useState<Fact['relationship']>('interested');
  const [adding, setAdding] = useState(false); const [addError, setAddError] = useState('');
  const [attemptedSave, setAttemptedSave] = useState(false);
  const nameMissing = !settings.display_name.trim();
  const previewNameMissing = showPreview && !!preview.enabled && !preview.display_name.trim();
  const missingRequired = requiredProfileDetails(draft, settings, preview, showPreview);
  const topicsToAdd = unmatchedTopics(settings, draft.facts);
  const setFact = (id: string, patch: Partial<Fact>) => setDraft(d => ({ ...d, facts: d.facts.map(f => f.fact_id === id ? { ...f, ...patch } : f) }));
  async function addFact() {
    setAdding(true); setAddError('');
    try {
      const answer = await api<{ answer_id: string }>('/v1/profile/answers', { method: 'POST', body: { question_key: role === 'experienced' ? 'experiences' : role === 'can_share' ? 'open_topics' : 'interests', question_text: `What would you like to tell us about ${topic.trim()}? (${role})`, answer_text: details.trim() } });
      setDraft(d => ({ ...d, facts: [...d.facts, approvedDetail(topic, details, role, answer.answer_id, Crypto.randomUUID())] }));
      setTopic(''); setDetails('');
    } catch (e) { setAddError(errorMessage(e)); } finally { setAdding(false); }
  }
  return <View style={{ gap: 24 }}>
    <Section title="About you"><Field label="Your name (required)" value={settings.display_name} maxLength={80} onChangeText={display_name => setSettings({ ...settings, display_name })} placeholder="What should people call you?" />
      {nameMissing && <Notice>Enter your name to save your profile.</Notice>}
      <Field label="Occupation" value={settings.occupation} maxLength={160} onChangeText={occupation => setSettings({ ...settings, occupation })} placeholder="What you do, in your own words" />
      <Field label="Home base" value={settings.profile_location} maxLength={200} onChangeText={profile_location => setSettings({ ...settings, profile_location })} placeholder="A city or neighborhood" />
      <ListField label="Skills" values={settings.skills} onChange={skills => setSettings({ ...settings, skills })} />
      <ListField label="Interests" values={settings.interests} onChange={interests => setSettings({ ...settings, interests })} />
      <ListField label="Traits you identify with" values={settings.personality_traits} onChange={personality_traits => setSettings({ ...settings, personality_traits })} placeholder="Curious, thoughtful, adventurous…" />
    </Section>
    <Section title="Meeting preferences">
      <View style={{ gap: 9 }}><Label>My gender (private)</Label><View style={s.chips}>{genders.map(([gender]) => <Pressable key={gender} accessibilityRole="radio" accessibilityState={{ checked: settings.gender_identity === gender }} onPress={() => setSettings({ ...settings, gender_identity: gender })} style={[s.chip, settings.gender_identity === gender && { backgroundColor: colors.action }]}><Text style={[s.chipText, settings.gender_identity === gender && { color: 'white' }]}>{identityLabels[gender]}</Text></Pressable>)}</View></View>
      <View style={{ gap: 9 }}><Label>People I’m open to meeting</Label><Body muted>Leave all unselected to meet everyone. Preferences are mutual, and your gender is never shown on your preview.</Body><View style={s.chips}>{genders.map(([gender, label]) => { const selected = settings.gender_preferences.includes(gender); return <Pressable key={gender} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => setSettings({ ...settings, gender_preferences: selected ? settings.gender_preferences.filter(value => value !== gender) : [...settings.gender_preferences, gender] })} style={[s.chip, selected && { backgroundColor: colors.action }]}><Text style={[s.chipText, selected && { color: 'white' }]}>{label}</Text></Pressable>; })}</View></View>
    </Section>
    <Section title="What are you open to?"><Field label="Something you’re exploring right now" value={draft.current_goal} maxLength={2000} onChangeText={current_goal => setDraft(changeConversationGoal(draft, current_goal))} multiline placeholder="A question, a project, a new experience…" />
      <Field label="The kind of conversation I’m looking for" value={draft.conversation_intent ?? ''} maxLength={1000} onChangeText={conversation_intent => setDraft({ ...draft, conversation_intent })} placeholder="Hear how someone got started, swap ideas…" />
      <View style={{ gap: 9 }}><Label>I’d like to…</Label><View style={s.chips}>{modes.map(([mode, label]) => <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: settings.matching_context === mode }} onPress={() => { if (mode !== settings.matching_context) { setSettings({ ...settings, matching_context: mode }); setDraft({ ...draft, conversation_request: null }); } }} style={[s.chip, settings.matching_context === mode && { backgroundColor: colors.action }]}><Text style={[s.chipText, settings.matching_context === mode && { color: 'white' }]}>{label}</Text></Pressable>)}</View></View>
      <ListField label="Topics I’m happy to discuss" values={draft.open_to_discussing} onChange={open_to_discussing => setDraft({ ...draft, open_to_discussing })} />
      <ListField label="Conversation preferences" values={draft.conversation_preferences} onChange={conversation_preferences => setDraft({ ...draft, conversation_preferences })} placeholder="Small groups, patient explanations…" />
      {draft.avoid_topics.length > 0 && <><Notice>Your previously saved topic boundaries remain in place, so matching stays paused. You can remove them here if you choose.</Notice>
        <Button title="Remove saved topic boundaries" variant="secondary" onPress={() => setDraft({ ...draft, avoid_topics: [] })} /></>}
    </Section>
    <ConversationRequestFields request={draft.conversation_request} mode={settings.matching_context} goal={draft.current_goal} onChange={conversation_request => setDraft({ ...draft, conversation_request })} />
    <View style={{ gap: 14 }}><Text style={s.cardTitle}>The things that make you, you</Text><Body muted>Review each detail before it helps you find people. You control whether it can be shared after you both accept.</Body></View>
    {draft.facts.map(fact => <Section key={fact.fact_id} title={fact.topic} subtitle={fact.relationship.replaceAll('_', ' ')}><View style={{ gap: 6 }}><Body>{fact.details}</Body>{!!fact.motivation && <Body muted>{fact.motivation}</Body>}</View>
      <Toggle title="This is right. Use it for matching." value={fact.confirmation === 'confirmed' && fact.matching_allowed} onValueChange={on => setFact(fact.fact_id, { confirmation: on ? 'confirmed' : 'rejected', matching_allowed: on, sharing_scope: on ? fact.sharing_scope : 'matching_only' })} />
      <Toggle title="Share after we both accept" value={fact.sharing_scope === 'after_mutual_consent'} disabled={fact.confirmation !== 'confirmed'} onValueChange={on => setFact(fact.fact_id, { sharing_scope: on ? 'after_mutual_consent' : 'matching_only' })} />
    </Section>)}
    <Section title="Add something in your own words">
      {topicsToAdd.length > 0 && <><Notice>{topicsToAdd.length} saved skill or interest topics are not yet approved matching details.</Notice><View style={s.chips}>{topicsToAdd.map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Add matching detail about ${value}`} onPress={() => { setTopic(value); setDetails(''); setRole('interested'); }} style={s.chip}><Text style={s.chipText}>{value}</Text></Pressable>)}</View></>}
      <Field label="Topic" value={topic} maxLength={500} onChangeText={setTopic} placeholder="Trail running, architecture, your next idea…" /><View style={s.chips}>{(['interested', 'experienced', 'wants_to_try', 'learning', 'can_share'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: role === value }} onPress={() => setRole(value)} style={[s.chip, role === value && { backgroundColor: colors.action }]}><Text style={[s.chipText, role === value && { color: 'white' }]}>{value.replaceAll('_', ' ')}</Text></Pressable>)}</View><Field label="What would you like us to know?" placeholder="What specifically interests you, what have you tried, or what would you like to explore with someone?" multiline maxLength={2000} value={details} onChangeText={setDetails} />{!!addError && <Notice error>{addError}</Notice>}<Button title="Add approved matching detail" variant="secondary" loading={adding} disabled={!topic.trim() || !details.trim() || draft.facts.length >= 50} onPress={() => void addFact()} /></Section>
    {showPreview && <Section title="Your first impression"><Body muted>Nearby shows only this preview. Your other details stay private until you both choose to connect.</Body><Toggle title="Show my preview to nearby people" value={!!preview.enabled} onValueChange={enabled => setPreview({ ...preview, enabled })} /><Field label={preview.enabled ? 'Preview name (required)' : 'Preview name'} value={preview.display_name} maxLength={80} onChangeText={display_name => setPreview({ ...preview, display_name })} />
      {previewNameMissing && <Notice>Choose a name for nearby people to see, or turn off your preview.</Notice>}
      <ListField label="Preview interests (up to 8)" values={preview.interests} onChange={interests => setPreview({ ...preview, interests: interests.slice(0, 8) })} /></Section>}
    {!!error && <Notice error>{error}</Notice>}
    {attemptedSave && missingRequired.length > 0 && <Notice error>Complete these required matching details before saving: {missingRequired.join(' ')}</Notice>}
    <Button title={onboarding ? 'Save my profile' : 'Save changes'} loading={saving} disabled={adding} onPress={() => {
      setAttemptedSave(true);
      if (missingRequired.length > 0) return;
      onSave({ profile: { ...draft, conversation_intent: draft.conversation_intent?.trim() || null, conversation_request: currentConversationRequest(draft.conversation_request, settings.matching_context, draft.current_goal) }, settings: profileSettingsForSave(settings), preview, update_preview: showPreview });
    }} icon="checkmark" />
  </View>;
}
