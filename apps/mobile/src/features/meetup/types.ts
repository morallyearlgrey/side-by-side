export type MeetupPoint = { latitude: number; longitude: number; accuracy_m: number; observed_at: string };
export type MeetupState = {
  status: 'off' | 'waiting' | 'stale' | 'sharing' | 'unavailable';
  sharing: boolean; peer_sharing: boolean; share_id: string | null;
  sharing_until: string | null; valid_until: string | null;
  me: MeetupPoint | null; peer: MeetupPoint | null;
};

export function canShowMeetup(state: MeetupState | null, now = Date.now()): state is MeetupState & { me: MeetupPoint; peer: MeetupPoint } {
  return !!state && state.status === 'sharing' && state.sharing && state.peer_sharing
    && !!state.me && !!state.peer && !!state.valid_until && Date.parse(state.valid_until) > now
    && !!state.sharing_until && Date.parse(state.sharing_until) > now;
}

export function hideMeetupPoints(state: MeetupState | null): MeetupState | null {
  return state ? { ...state, me: null, peer: null, valid_until: null } : null;
}
