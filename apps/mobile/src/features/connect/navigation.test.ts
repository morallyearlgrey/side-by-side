import { readFileSync, readdirSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { connectionPagePath } from './connectionQuery';
import { DiscoveryControls } from './DiscoveryControls';
const controls = vi.hoisted(() => ({
  platform: { OS: 'ios' },
  ready: false, consent: false, profileId: 'saved-profile' as string | null, boundaryReview: false,
  push: vi.fn(), setState: vi.fn(), hide: vi.fn(), api: vi.fn(),
  presence: { enabled: false, busy: false, stage: 'idle', lastUpdated: null, error: '', enable: vi.fn(), disable: vi.fn() },
  ble: { state: { available: true, live: false, status: 'idle', scanning: false, advertising: false }, busy: false, error: '', encounters: [], start: vi.fn(), stop: vi.fn() },
}));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useState: (value: unknown) => [value, controls.setState] }));
vi.mock('react-native', () => ({ Platform: controls.platform }));
vi.mock('expo-linking', () => ({ openSettings: vi.fn() }));
vi.mock('expo-router', () => ({ router: { push: controls.push } }));
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({}), useQueryClient: () => ({}) }));
vi.mock('@/components/ui', () => ({ Body: 'Body', Button: 'Button', Field: 'Field', Notice: 'Notice', Toggle: 'Toggle' }));
vi.mock('@/features/profile/useMe', () => ({ useMe: () => ({ data: { profile: { settings: {}, current_profile_version_id: controls.profileId }, matching_consent: controls.consent, preview: { enabled: false } } }) }));
vi.mock('@/features/profile/matchingReadiness', () => ({ matchingReadiness: () => ({ ready: controls.ready, boundaryReview: controls.boundaryReview, checks: [{ id: 'request', label: 'Confirmed conversation goal', ready: controls.ready }, { id: 'preview', label: 'Enabled nearby preview', ready: controls.ready }, { id: 'consent', label: 'Matching permission', ready: controls.consent }] }) }));
vi.mock('@/lib/api', () => ({ api: controls.api, errorMessage: String }));
vi.mock('./DiscoveryProvider', () => ({ useDiscovery: () => ({ ...controls, presence: controls.presence, ble: controls.ble }) }));

function controlProps(title: string): Record<string, unknown> {
  const visit = (node: unknown): ReactElement<Record<string, unknown>> | undefined => {
    if (Array.isArray(node)) return node.map(visit).find(Boolean);
    if (!isValidElement<Record<string, unknown>>(node)) return;
    if (node.props.title === title) return node;
    return visit(node.props.children);
  };
  const found = visit(DiscoveryControls());
  if (!found) throw new Error(`Missing control: ${title}`);
  return found.props;
}

describe('discovery controls stay on the current screen', () => {
  beforeEach(() => {
    vi.clearAllMocks(); controls.ready = false; controls.consent = false; controls.profileId = 'saved-profile'; controls.boundaryReview = false;
    controls.platform.OS = 'ios';
    controls.presence.enabled = false; controls.presence.error = '';
    controls.ble.state.live = false; controls.ble.error = '';
  });
  it.each(['Location', 'Bluetooth'])('a blocked %s switch shows inline guidance without navigation or enabling discovery', kind => {
    const props = controlProps(`${kind} discovery`);
    expect(props.disabled).toBeFalsy();
    (props.onValueChange as (value: boolean) => void)(true);
    expect(controls.setState).toHaveBeenCalledWith(kind);
    expect(controls.push).not.toHaveBeenCalled();
    expect(controls.presence.enable).not.toHaveBeenCalled();
    expect(controls.ble.start).not.toHaveBeenCalled();
    expect(controls.api).not.toHaveBeenCalled();
  });
  it.each(['location', 'Bluetooth'])('a blocked Retry %s also stays on the same screen', kind => {
    controls.presence.error = 'Permission needed'; controls.ble.error = 'Permission needed';
    (controlProps(`Retry ${kind}`).onPress as () => void)();
    expect(controls.push).not.toHaveBeenCalled();
    expect(controls.presence.enable).not.toHaveBeenCalled();
    expect(controls.ble.start).not.toHaveBeenCalled();
  });
  it('can still stop either discovery mode after setup becomes incomplete', () => {
    controls.presence.enabled = true; controls.ble.state.live = true;
    (controlProps('Location discovery').onValueChange as (value: boolean) => void)(false);
    (controlProps('Bluetooth discovery').onValueChange as (value: boolean) => void)(false);
    expect(controls.presence.disable).toHaveBeenCalledOnce();
    expect(controls.ble.stop).toHaveBeenCalledOnce();
    expect(controls.push).not.toHaveBeenCalled();
  });
  it('only navigates when the user chooses an explicit setup button', () => {
    (controlProps('Review profile for discovery').onPress as () => void)();
    expect(controls.push).toHaveBeenLastCalledWith('/(tabs)/profile');
    (controlProps('Review matching and preview settings').onPress as () => void)();
    expect(controls.push).toHaveBeenLastCalledWith('/(tabs)/settings');
  });
  it('starts device discovery with saved profile and consent despite unconfirmed matching setup, hidden preview, and saved boundaries', () => {
    controls.consent = true; controls.boundaryReview = true;
    (controlProps('Location discovery').onValueChange as (value: boolean) => void)(true);
    (controlProps('Bluetooth discovery').onValueChange as (value: boolean) => void)(true);
    expect(controls.presence.enable).toHaveBeenCalledOnce();
    expect(controls.ble.start).toHaveBeenCalledOnce();
    expect(controls.push).not.toHaveBeenCalled();
    expect(controls.api).not.toHaveBeenCalled();
  });
  it('still requires a saved profile even when matching permission is on', () => {
    controls.profileId = null; controls.consent = true;
    (controlProps('Location discovery').onValueChange as (value: boolean) => void)(true);
    (controlProps('Bluetooth discovery').onValueChange as (value: boolean) => void)(true);
    expect(controls.presence.enable).not.toHaveBeenCalled();
    expect(controls.ble.start).not.toHaveBeenCalled();
    expect(controls.push).not.toHaveBeenCalled();
  });
  it('shows only location controls in the browser', () => {
    controls.platform.OS = 'web';
    expect(() => controlProps('Bluetooth discovery')).toThrow('Missing control');
    expect(() => controlProps('Nearby sharing')).toThrow('Missing control');
    expect(controlProps('Location discovery')).toBeDefined();
  });
  it('browser location sharing starts and stops without Bluetooth actions', () => {
    controls.platform.OS = 'web'; controls.consent = true;
    const props = controlProps('Location discovery');
    (props.onValueChange as (value: boolean) => void)(true);
    (props.onValueChange as (value: boolean) => void)(false);
    expect(controls.presence.enable).toHaveBeenCalledOnce();
    expect(controls.presence.disable).toHaveBeenCalledOnce();
    expect(controls.ble.start).not.toHaveBeenCalled();
    expect(controls.ble.stop).not.toHaveBeenCalled();
  });
});
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
describe('navigation content boundaries', () => {
  it('orders the five user tabs while keeping the old Bluetooth deep link hidden', () => {
    const layout = source('../../app/(tabs)/_layout.tsx');
    expect([...layout.matchAll(/Tabs.Screen name="([^"]+)"/g)].map(match => match[1])).toEqual(['home', 'connect', 'matches', 'profile', 'settings', 'bluetooth']);
    expect(layout).toContain('href: null');
    expect(source('../../app/(tabs)/profile.tsx')).toContain('<ProfileForm');
    const settings = source('../../app/(tabs)/settings.tsx');
    expect(settings).not.toContain('<ProfileForm');
    expect(settings).toContain('<Core2Badges'); expect(settings).toContain('<OptionalDevices');
    expect(settings).toContain('/v1/devices/signout');
  });
  it('encodes queries for server filtering before pagination', () => {
    expect(connectionPagePath('ceramics & tea', 'liked', 3)).toBe('/v1/connections/page?q=ceramics%20%26%20tea&filter=liked&page=3');
    expect(connectionPagePath('', 'all', -1)).toContain('page=1');
  });
  it('removes checklist and answer displays while keeping readiness gates', () => {
    const routes = new URL('../../app/', import.meta.url);
    for (const file of readdirSync(routes, { recursive: true }).filter(file => file.toString().endsWith('.tsx'))) {
      expect(readFileSync(new URL(file.toString(), routes), 'utf8')).not.toMatch(/ReadinessChecklist|Before you meet people/);
    }
    expect(source('../../app/(tabs)/profile.tsx')).not.toMatch(/onboarding_answers|original_answer_ids|Approved predictor inputs/);
    expect(source('../../app/onboarding/permissions.tsx')).toContain('<DiscoveryControls');
    expect(source('./DiscoveryControls.tsx')).toContain('matchingReadiness');
  });
  it('owns matching consent only in Settings and hands initial review there', () => {
    const form = source('../profile/ProfileForm.tsx');
    expect(form).not.toMatch(/initialConsent|matching_consent|Use my approved details for matching/);
    expect(form).not.toContain('From your answer:');
    expect(source('../../app/(tabs)/settings.tsx')).toContain("'/v1/consents'");
    expect(source('../../app/(tabs)/settings.tsx')).toContain('value={!!me.data?.matching_consent}');
    expect(source('../../app/onboarding/review.tsx')).toContain("pathname: '/(tabs)/settings'");
  });
});
