import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Discovery } from '@/lib/types';
import Connect from '../../app/(tabs)/connect';

const fixture = vi.hoisted(() => ({
  userId: 'owner-a' as string | undefined,
  available: true as boolean | undefined,
  consent: true,
  previewEnabled: true,
  api: vi.fn(), invalidate: vi.fn(), hide: vi.fn(), refreshLocation: vi.fn(),
  item: {
    event_key: 'same-discovery', candidate_id: 'peer', viewer_version_id: 'owner-version',
    candidate_version_id: 'peer-version', mode: 'nearby', status: 'recommend', sources: ['nearby'],
    preview: { display_name: 'Fictional neighbor', interests: ['pottery'] }, preference: null,
    valid_until: '2099-01-01T00:00:00Z',
  } as Discovery,
}));

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => [value, vi.fn()],
  useCallback: (callback: unknown) => callback,
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Text: 'Text', View: 'View',
  Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 1280, height: 800 }),
}));
vi.mock('expo-router', () => ({ useFocusEffect: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({
  useMutation: ({ mutationFn }: { mutationFn: () => Promise<unknown> }) => ({
    mutate: vi.fn(() => mutationFn()), isPending: false, error: null,
  }),
  useQueryClient: () => ({ invalidateQueries: fixture.invalidate }),
}));
vi.mock('@/components/ui', () => ({
  Body: 'Body', Brand: 'Brand', Button: 'Button', Card: 'Card', Chips: 'Chips',
  EmptyState: 'EmptyState', Notice: 'Notice', Screen: 'Screen', s: {},
}));
vi.mock('@/features/connect/DiscoveryProvider', () => ({ useDiscovery: () => ({
  presence: { enabled: true, stage: 'idle', refresh: fixture.refreshLocation },
  ble: { state: { live: false }, encounters: [] }, items: [fixture.item],
  hide: fixture.hide, refresh: vi.fn(),
}) }));
vi.mock('@/features/profile/useMe', () => ({ useMe: () => ({
  data: fixture.userId ? {
    profile: { user_id: fixture.userId, available: fixture.available, settings: {} },
    matching_consent: fixture.consent, preview: { enabled: fixture.previewEnabled },
  } : undefined,
}) }));
vi.mock('@/features/connect/DiscoveryControls', () => ({ DiscoveryControls: 'DiscoveryControls' }));
vi.mock('@/features/connect/MatchingConsent', () => ({ MatchingConsent: 'MatchingConsent' }));
vi.mock('@/features/connect/MatchDescription', () => ({ MatchDescription: 'MatchDescription' }));
vi.mock('@/features/connect/MatchNotifications', () => ({ discoveryTarget: vi.fn() }));
vi.mock('@/features/connect/ConnectHero', () => ({ ConnectHero: 'ConnectHero', EclipseDivider: 'EclipseDivider' }));
vi.mock('@/features/profile/PreviewSettings', () => ({ PreviewSettings: 'PreviewSettings' }));
vi.mock('@/features/profile/matchingReadiness', () => ({ matchingReadiness: vi.fn() }));
vi.mock('@/features/connect/discoveryEmptyState', () => ({ discoveryEmptyState: () => ({ title: '', message: '' }) }));
vi.mock('@/features/tags/AprilTag', () => ({ AprilTagCard: 'AprilTagCard' }));
vi.mock('@/features/connect/ConnectionInvitations', () => ({ ConnectionInvitations: 'ConnectionInvitations' }));
vi.mock('@/features/locationMap/DiscoveryLocationMap', () => ({ default: 'DiscoveryLocationMap' }));
vi.mock('@/lib/api', () => ({ api: fixture.api, errorMessage: String }));
vi.mock('@/lib/theme', () => ({ colors: { violet: '#FF6D29' } }));

function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function discoveryCard() {
  const card = elements(Connect()).find(node => typeof node.type === 'function' && node.props.item === fixture.item);
  if (!card) throw new Error('Missing discovery card');
  return card;
}

function renderCard() {
  const card = discoveryCard();
  return (card.type as (props: Record<string, unknown>) => ReactNode)(card.props);
}

function button(tree: unknown, title: string) {
  const found = elements(tree).find(node => node.type === 'Button' && node.props.title === title);
  if (!found) throw new Error(`Missing button: ${title}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.userId = 'owner-a'; fixture.available = true;
  fixture.consent = fixture.previewEnabled = true;
  fixture.api.mockResolvedValue({});
  fixture.refreshLocation.mockResolvedValue(undefined);
});

describe('Connect invitation and location consent', () => {
  it('explains acceptance and separate location consent before offering Accept and invite', () => {
    const tree = renderCard();
    const nodes = elements(tree);
    const explanation = nodes.findIndex(node => node.type === 'Body'
      && typeof node.props.children === 'string'
      && /approved details after they accept too/.test(node.props.children)
      && /Location sharing is a separate choice/.test(node.props.children));
    expect(explanation).toBeGreaterThanOrEqual(0);
    expect(nodes.indexOf(button(tree, 'Accept and invite'))).toBeGreaterThan(explanation);
    expect(nodes.some(node => node.props.title === 'Interested')).toBe(false);
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it.each(['owner-a', 'owner-b'])('binds an explicit invitation to rendered account %s', async owner => {
    fixture.userId = owner;
    const tree = renderCard();
    // A deferred click must retain its original owner for the API's account-change check.
    fixture.userId = 'different-account';
    await (button(tree, 'Accept and invite').props.onPress as () => Promise<unknown>)();
    expect(fixture.api).toHaveBeenCalledExactlyOnceWith('/v1/connections', {
      method: 'POST', expectedUserId: owner, body: { candidate_id: 'peer', mode: 'nearby' },
    });
    expect(fixture.refreshLocation).not.toHaveBeenCalled();
  });

  it('uses a different card identity when the account changes with the same discovery', () => {
    const first = discoveryCard();
    expect(first.key).not.toBeNull();
    expect(discoveryCard().key).toBe(first.key);
    fixture.userId = 'owner-b';
    const second = discoveryCard();
    expect(second.key).not.toBe(first.key);
    expect(first.props.userId).toBe('owner-a');
    expect(second.props.userId).toBe('owner-b');
  });

  it('does not expose an invitation action or location map without an account owner', () => {
    fixture.userId = undefined;
    const nodes = elements(Connect());
    expect(nodes.some(node => node.props.item === fixture.item)).toBe(false);
    expect(nodes.some(node => node.type === 'DiscoveryLocationMap')).toBe(false);
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it('declining a suggestion does not accept it or grant location sharing', () => {
    (button(renderCard(), 'Decline suggestion').props.onPress as () => void)();
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.refreshLocation).not.toHaveBeenCalled();
  });

  it.each([
    { consent: true, preview: true, available: true, allowed: true },
    { consent: false, preview: true, available: true, allowed: false },
    { consent: true, preview: false, available: true, allowed: false },
    { consent: true, preview: true, available: false, allowed: false },
    { consent: true, preview: true, available: undefined, allowed: true },
  ])('passes the map gate for consent=$consent, preview=$preview, available=$available', ({ consent, preview, available, allowed }) => {
    fixture.consent = consent; fixture.previewEnabled = preview; fixture.available = available;
    const map = elements(Connect()).find(node => node.type === 'DiscoveryLocationMap');
    expect(map).toBeDefined();
    expect(map!.props).toMatchObject({ userId: 'owner-a', locationEnabled: true, bluetoothEnabled: false, sharingAllowed: allowed });
    expect(fixture.api).not.toHaveBeenCalled();
  });
});
