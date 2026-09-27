import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '@/lib/types';
import { ConnectionInvitations, InvitationCard } from './ConnectionInvitations';
import { isMutuallyAccepted, isPendingInvitation } from './connectionVisibility';

const fixture = vi.hoisted(() => ({
  now: 1_800_000_000_000,
  api: vi.fn(), mutate: vi.fn(), queryOptions: vi.fn(), mutationOptions: vi.fn(),
  query: { data: { items: [] as Connection[] }, dataUpdatedAt: 1_800_000_000_000, isFetching: false, error: null, refetch: vi.fn() },
  mutation: { isPending: false, isSuccess: false, error: null },
  cancel: vi.fn(), setData: vi.fn(), invalidate: vi.fn(), remove: vi.fn(),
}));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => [value, vi.fn()], useEffect: vi.fn(),
}));
vi.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', View: 'View', Text: 'Text', AppState: { currentState: 'active' } }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => { fixture.queryOptions(options); return fixture.query; },
  useMutation: (options: unknown) => { fixture.mutationOptions(options); return { ...fixture.mutation, mutate: fixture.mutate }; },
  useQueryClient: () => ({ cancelQueries: fixture.cancel, setQueryData: fixture.setData, invalidateQueries: fixture.invalidate, removeQueries: fixture.remove }),
}));
vi.mock('@/components/ui', () => ({ Body: 'Body', Button: 'Button', Card: 'Card', Chips: 'Chips', Notice: 'Notice', s: {} }));
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'amy' } } }) }));
vi.mock('@/lib/api', () => ({ api: fixture.api, errorMessage: String }));
vi.mock('./MatchDescription', () => ({ MatchDescription: 'MatchDescription' }));

function invitation(overrides: Partial<Connection> = {}): Connection {
  return { request_id: 'pair-request', requester_id: 'amy', recipient_id: 'steve',
    requester_decision: 'accepted', recipient_decision: 'pending', status: 'pending',
    candidate_id: 'steve', viewer_version_id: 'amy-v1', candidate_version_id: 'steve-v1', preference: null,
    preview: { display_name: 'Fictional Steve', interests: ['pottery'] }, created_at: new Date(fixture.now).toISOString(),
    expires_at: new Date(fixture.now+60000).toISOString(), ...overrides };
}
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function button(tree: unknown, title: string) {
  return elements(tree).find(node => node.props.title === title);
}

beforeEach(() => {
  vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(fixture.now);
  fixture.query.data = { items: [invitation()] };
  fixture.query.dataUpdatedAt = fixture.now;
  fixture.mutation.isPending = fixture.mutation.isSuccess = false;
});

describe('shared invitations stay on Connect until both accept', () => {
  it('one acceptance is visible to both participants but never a Match', () => {
    const row = invitation();
    expect(isPendingInvitation(row, 'amy')).toBe(true);
    expect(isPendingInvitation(row, 'steve')).toBe(true);
    expect(isPendingInvitation(row, 'outsider')).toBe(false);
    expect(isMutuallyAccepted(row)).toBe(false);
    expect(isMutuallyAccepted({ ...row, status: 'accepted' })).toBe(false);
    expect(isMutuallyAccepted({ ...row, status: 'accepted', recipient_decision: 'accepted' })).toBe(true);
    expect(isPendingInvitation({ ...row, status: 'accepted', recipient_decision: 'accepted' }, 'amy')).toBe(false);
  });
  it('a model suggestion starts pending for both and offers each person an independent choice', () => {
    const row = invitation({ requester_decision: 'pending', recipient_decision: 'pending' });
    expect(isPendingInvitation(row, 'amy')).toBe(true);
    expect(isPendingInvitation(row, 'steve')).toBe(true);
    expect(isMutuallyAccepted(row)).toBe(false);
    for (const userId of ['amy', 'steve']) {
      const tree = InvitationCard({ item: row, userId });
      expect(elements(tree).some(node => node.type === 'Card' && node.props.subtitle === 'Open for interests, conversation starters and event ideas')).toBe(true);
      expect(elements(tree).some(node => node.type === 'MatchDescription')).toBe(true);
      (button(tree, 'Accept connection')!.props.onPress as () => void)();
      expect(fixture.mutate).toHaveBeenLastCalledWith('accepted');
      (button(tree, 'Deny for both')!.props.onPress as () => void)();
      expect(fixture.mutate).toHaveBeenLastCalledWith('declined');
    }
  });
  it.each(['declined', 'revoked', 'profile_changed', 'unavailable'])('never shows %s as a pending invitation or Match', status => {
    const row = invitation({ status });
    expect(isPendingInvitation(row, 'amy')).toBe(false);
    expect(isMutuallyAccepted(row)).toBe(false);
    expect(InvitationCard({ item: row, userId: 'amy' })).toBeNull();
  });
  it('hides expired and malformed expiry immediately, before another server poll', () => {
    for (const expires_at of [new Date(fixture.now-1).toISOString(), 'unknown']) {
      expect(InvitationCard({ item: invitation({ expires_at }), userId: 'amy' })).toBeNull();
    }
  });
  it('sender waits and can cancel; recipient can explicitly accept or decline the same request', async () => {
    const row = invitation();
    const sender = InvitationCard({ item: row, userId: 'amy' });
    expect(button(sender, 'Accept invitation')).toBeUndefined();
    (button(sender, 'Withdraw for both')!.props.onPress as () => void)();
    expect(fixture.mutate).toHaveBeenLastCalledWith('revoked');
    const recipient = InvitationCard({ item: row, userId: 'steve' });
    (button(recipient, 'Accept invitation')!.props.onPress as () => void)();
    expect(fixture.mutate).toHaveBeenLastCalledWith('accepted');
    (button(recipient, 'Deny for both')!.props.onPress as () => void)();
    expect(fixture.mutate).toHaveBeenLastCalledWith('declined');
    await fixture.mutationOptions.mock.lastCall![0].mutationFn('accepted');
    expect(fixture.api).toHaveBeenLastCalledWith('/v1/connections/pair-request/decision', {
      method: 'PUT', expectedUserId: 'steve', body: { decision: 'accepted' },
    });
  });
  it('fetches shared requests independently of location, Bluetooth, reverse scores or discovery state', async () => {
    const tree = ConnectionInvitations({ active: true });
    const opts = fixture.queryOptions.mock.lastCall![0];
    expect(opts.enabled).toBe(true);
    expect(opts.refetchInterval).toBe(5000);
    await opts.queryFn({ signal: undefined });
    expect(fixture.api).toHaveBeenLastCalledWith('/v1/connections/invitations', { signal: undefined, expectedUserId: 'amy' });
    expect(elements(tree).some(node => node.type === InvitationCard)).toBe(true);
  });
  it('hides stale pending cards and does not fetch while Connect is inactive', () => {
    fixture.query.dataUpdatedAt = fixture.now-21000;
    expect(elements(ConnectionInvitations({ active: true })).some(node => node.type === InvitationCard)).toBe(false);
    expect(elements(ConnectionInvitations({ active: false })).some(node => node.type === InvitationCard)).toBe(false);
    expect(fixture.queryOptions.mock.lastCall![0].enabled).toBe(false);
  });
});
