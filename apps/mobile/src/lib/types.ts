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
export type UserSettings = { discovery_radius_m?: number; muse_descriptions_enabled?: boolean; display_name: string; occupation: string; skills: string[]; interests: string[]; personality_traits: string[]; profile_location: string; matching_context: Mode; hard_filters: { conversation_intents: string[] }; discoverable: boolean; bluetooth_enabled: boolean };
export type ProfileVersion = ProfileDraft & { profile_version_id: string; valid_from: string; onboarding_answers?: { answer_id: string; question_text?: string; answer_text: string }[] };
export type Me = {
  profile: { user_id: string; display_name: string; current_profile_version_id: string | null; discoverable: boolean; settings: UserSettings; [key: string]: unknown };
  current_version: ProfileVersion | null; preview: Preview | null;
  april_tag?: { family: 'tag36h11'; tag_id: number; marker_size_tenths_mm: number; stable: true } | null;
  onboarding: OnboardingSession | null; readiness: Record<string, unknown>; matching_consent?: boolean; original_answer_ids?: string[];
};
export type OnboardingSession = { session_id: string; status: string; answers_count?: number; max_answers?: number; draft_incomplete?: boolean; turns: { id: string; role: 'assistant' | 'user'; content: string; question_key: string; created_at: string }[]; draft: ProfileDraft | null; provider: { available: boolean; reason?: string }; ready_for_review?: boolean; error?: { code: string; message: string } | null };
export type ReviewRequest = { profile: ProfileDraft; settings: Omit<UserSettings, 'discoverable' | 'bluetooth_enabled'>; preview: Preview; update_preview?: boolean };
export type MatchingDecision = 'recommend' | 'not_recommended' | 'insufficient_evidence' | 'unavailable';
export type NearbyPerson = { user_id: string; preview: Preview; score: number; status: 'recommend'; distance_m: number };
export type NearbyPage = { items: NearbyPerson[]; next_cursor: string | null; snapshot_id: string; pending_count: number; not_recommended_count: number; insufficient_evidence_count: number; unavailable_count: number; model: { available?: boolean; reason?: string; [key: string]: unknown } };
export type BleConversationContext = { key: string; reason: string; topic: string | null };
export type ConversationIdea = { context_key: string; reason: string; opener: string; source: 'muse' | 'fallback' };
export type Encounter = { status: MatchingDecision | 'pending'; candidate_id?: string; preview?: Preview; score: number | null; reason?: string; conversation_context?: BleConversationContext | null };
export type Preference = 'liked' | 'disliked';
export type MatchTarget = { candidate_id: string; viewer_version_id: string; candidate_version_id: string; mode?: 'nearby' | 'ble'; connection_id?: string | null };
export type ActivitySuggestion = {
  id: string; title: string; summary: string; venue: string; area: string; tags: string[];
  cost: string; cost_note: string; eligibility: string; eligibility_note: string;
  duration_minutes: number | null; indoor: boolean | null;
  source_url: string; source_name: string; source_checked_at: string; review_after: string;
  kind: 'evergreen' | 'recurring' | 'event'; starts_at: string | null; ends_at: string | null; status: string;
  invitation: string; reason: string; basis: 'both_interests' | 'one_interest' | 'general_activity';
};
export type MatchDescriptionResult = {
  status: 'ready'; provider: 'Muse' | null; source: 'muse' | 'fallback'; description: string;
  conversation_starter: string; basis: 'shared_preview_topic' | 'approved_preview_topics' | 'general_activity';
  activities: ActivitySuggestion[]; activities_message?: string;
} | { status: 'unavailable' | 'error'; message: string };
export type Discovery = MatchTarget & { event_key: string; status: 'recommend'; sources: ('nearby' | 'ble')[]; preview: Preview; preference: Preference | null; valid_until: string };
export type Connection = MatchTarget & { preference: Preference | null; request_id: string; requester_id: string; recipient_id: string; requester_decision: string; recipient_decision: string; status: string; preview?: Preview; shared_profile?: { display_name?: string; facts?: Fact[]; [key: string]: unknown } };
export type ConnectionsPage = { items: Connection[]; page: number; pages: number; total: number; page_size: 6 };
export const emptyDraft: ProfileDraft = { current_goal: '', conversation_intent: '', facts: [], open_to_discussing: [], conversation_preferences: [], avoid_topics: [] };
export const emptySettings: UserSettings = { display_name: '', occupation: '', skills: [], interests: [], personality_traits: [], profile_location: '', matching_context: 'casual_chat', hard_filters: { conversation_intents: [] }, discoverable: false, bluetooth_enabled: false };
