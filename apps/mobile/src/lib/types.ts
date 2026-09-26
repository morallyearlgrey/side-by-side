export type Mode = 'learn' | 'share' | 'exchange_stories' | 'collaborate' | 'find_activity_partner' | 'casual_chat';
export type Fact = {
  fact_id: string; topic: string; relationship: 'interested' | 'experienced' | 'wants_to_try' | 'learning' | 'can_share'; details: string; motivation?: string | null;
  evidence: { source_type: 'onboarding_answer'; reference_id: string; channel: 'self_report'; support: string }[];
  confirmation: 'confirmed' | 'pending' | 'rejected'; matching_allowed: boolean; sharing_scope: 'matching_only' | 'after_mutual_consent';
};
export type EvidenceRequirement = { version: 1; kind: 'none' | 'firsthand' | 'unresolved'; subject: 'viewer' | 'candidate' | 'both' | null; claim: string | null; confirmation: 'confirmed' | 'pending' };
export type ConversationRequest = { mode: Mode; goal: string; evidence_requirement: EvidenceRequirement };
export type ProfileDraft = { current_goal: string; conversation_intent: string | null; facts: Fact[]; open_to_discussing: string[]; conversation_preferences: string[]; avoid_topics: string[]; conversation_request?: ConversationRequest | null };
export type Preview = { enabled?: boolean; display_name: string; interests: string[] };
export type UserSettings = { display_name: string; occupation: string; skills: string[]; interests: string[]; personality_traits: string[]; profile_location: string; matching_context: Mode; hard_filters: { conversation_intents: string[] }; discoverable: boolean; bluetooth_enabled: boolean };
export type ProfileVersion = ProfileDraft & { profile_version_id: string; valid_from: string };
export type Me = {
  profile: { user_id: string; display_name: string; current_profile_version_id: string | null; discoverable: boolean; settings: UserSettings; [key: string]: unknown };
  current_version: ProfileVersion | null; preview: Preview | null;
  onboarding: OnboardingSession | null; readiness: Record<string, unknown>; matching_consent?: boolean;
};
export type OnboardingSession = { session_id: string; status: string; answers_count?: number; max_answers?: number; draft_incomplete?: boolean; turns: { id: string; role: 'assistant' | 'user'; content: string; question_key: string; created_at: string }[]; draft: ProfileDraft | null; provider: { available: boolean; reason?: string }; ready_for_review?: boolean; error?: { code: string; message: string } | null };
export type ReviewRequest = { profile: ProfileDraft; settings: Omit<UserSettings, 'discoverable' | 'bluetooth_enabled'>; preview: Preview; matching_consent: boolean };
export type MatchingDecision = 'recommend' | 'not_recommended' | 'insufficient_evidence' | 'unavailable';
export type NearbyPerson = { user_id: string; preview: Preview; score: number; status: 'recommend'; distance_m: number };
export type NearbyPage = { items: NearbyPerson[]; next_cursor: string | null; snapshot_id: string; pending_count: number; not_recommended_count: number; insufficient_evidence_count: number; unavailable_count: number; model: { available?: boolean; reason?: string; [key: string]: unknown } };
export type BleConversationContext = { key: string; reason: string; topic: string | null };
export type ConversationIdea = { context_key: string; reason: string; opener: string; source: 'muse' | 'fallback' };
export type Encounter = { status: MatchingDecision | 'pending'; candidate_id?: string; preview?: Preview; score: number | null; reason?: string; conversation_context?: BleConversationContext | null };
export type Connection = { request_id: string; requester_id: string; recipient_id: string; requester_decision: string; recipient_decision: string; status: string; preview?: Preview; shared_profile?: { display_name?: string; facts?: Fact[]; [key: string]: unknown } };
export const emptyDraft: ProfileDraft = { current_goal: '', conversation_intent: '', facts: [], open_to_discussing: [], conversation_preferences: [], avoid_topics: [] };
export const emptySettings: UserSettings = { display_name: '', occupation: '', skills: [], interests: [], personality_traits: [], profile_location: '', matching_context: 'casual_chat', hard_filters: { conversation_intents: [] }, discoverable: false, bluetooth_enabled: false };
