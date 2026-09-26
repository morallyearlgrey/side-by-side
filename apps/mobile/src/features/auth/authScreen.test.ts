import { beforeEach, expect, it, vi } from 'vitest';
import AuthScreen from '../../app/auth';

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  loading: false,
  params: {} as { mode?: string },
}));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => [value, vi.fn()],
  useEffect: vi.fn(),
}));
vi.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', Text: 'Text' }));
vi.mock('expo-router', () => ({ Redirect: 'Redirect', router: { replace: vi.fn() }, useLocalSearchParams: () => state.params }));
vi.mock('expo-linking', () => ({ createURL: vi.fn() }));
vi.mock('@/components/ui', () => ({ Brand: 'Brand', Button: 'Button', Section: 'Section', Field: 'Field', Heading: 'Heading', Notice: 'Notice', Screen: 'Screen', s: {} }));
vi.mock('@/components/Lunar', () => ({ LunarArtwork: 'LunarArtwork' }));
vi.mock('@/lib/supabase', () => ({ supabase: null }));
vi.mock('@/lib/config', () => ({ authConfigured: true }));
vi.mock('@/lib/api', () => ({ errorMessage: String }));
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => state }));

beforeEach(() => { state.session = null; state.loading = false; state.params = {}; });

it('leaves the original signup tab when a session arrives after email confirmation elsewhere', () => {
  expect(AuthScreen().type).toBe('Screen');
  state.session = { user: { id: 'confirmed-user' } };
  const next = AuthScreen();
  expect(next.type).toBe('Redirect');
  expect(next.props.href).toBe('/');
});

it('routes a restored session away from the sign-in form', () => {
  state.params = { mode: 'signin' };
  state.session = { user: { id: 'returning-user' } };
  expect(AuthScreen().type).toBe('Redirect');
});

it('does not redirect before initial session loading finishes', () => {
  state.loading = true;
  state.session = { user: { id: 'restoring-user' } };
  expect(AuthScreen().type).toBe('Screen');
});

it('keeps the explicit password-recovery form accessible with an existing session', () => {
  state.params = { mode: 'recover' };
  state.session = { user: { id: 'recovering-user' } };
  expect(AuthScreen().type).toBe('Screen');
});
