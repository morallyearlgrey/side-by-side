import { readFileSync, readdirSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { connectionPagePath } from './connectionQuery';
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
describe('navigation content boundaries', () => {
  it('orders Profile, Settings, Matches, Connect while keeping the old Bluetooth deep link hidden', () => {
    const layout = source('../../app/(tabs)/_layout.tsx');
    expect([...layout.matchAll(/Tabs.Screen name="([^"]+)"/g)].map(match => match[1])).toEqual(['profile', 'settings', 'matches', 'index', 'bluetooth']);
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
    expect(source('../profile/ProfileForm.tsx')).not.toMatch(/They are not predictor inputs|The things that make you, you/);
    expect(source('../profile/ProfileForm.tsx')).toContain('Personal details (not used for matching)');
    expect(source('../../app/onboarding/permissions.tsx')).toContain('!profileReady');
    expect(source('./DiscoveryControls.tsx')).toContain('matchingReadiness');
  });
  it('owns matching consent only in Settings and hands initial review there', () => {
    const form = source('../profile/ProfileForm.tsx');
    expect(form).not.toMatch(/initialConsent|matching_consent|Use my approved details for matching/);
    expect(form).toContain('{onboarding && <Text style={s.small}>From your answer:');
    expect(source('../../app/(tabs)/settings.tsx')).toContain("'/v1/consents'");
    expect(source('../../app/(tabs)/settings.tsx')).toContain('value={!!me.data?.matching_consent}');
    expect(source('../../app/onboarding/review.tsx')).toContain("pathname: '/(tabs)/settings'");
  });
});
