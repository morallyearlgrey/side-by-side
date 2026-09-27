import { Fragment, isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionMeetup } from './ConnectionMeetup';

const fixture = vi.hoisted(() => ({
  error: '', start: vi.fn(), stop: vi.fn(),
}));

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock('react-native', () => ({ Text: 'Text', View: 'View' }));
vi.mock('@/components/ui', () => ({
  Body: 'Body', Button: 'Button', Label: 'Label', Notice: 'Notice', s: {},
}));
vi.mock('@/lib/theme', () => ({ colors: { line: '#333333' } }));
vi.mock('./useMeetup', () => ({ useMeetup: () => ({
  state: null, error: fixture.error, busy: false, clock: 1_800_000_000_000,
  start: fixture.start, stop: fixture.stop,
}) }));
vi.mock('./MeetupMap', () => ({ default: 'MeetupMap' }));
vi.mock('./GoogleMeetupMap', () => ({ default: 'GoogleMeetupMap' }));

function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function rawChildren(node: unknown): unknown[] {
  // Keep empty strings intact; React.Children.toArray would hide the regression.
  if (Array.isArray(node)) return node.flatMap(rawChildren);
  if (isValidElement<Record<string, unknown>>(node) && node.type === Fragment) {
    return rawChildren(node.props.children);
  }
  return [node];
}

function renderMeetup() {
  return ConnectionMeetup({ requestId: 'pair-request', userId: 'owner', peerName: 'Fictional neighbor' });
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.error = '';
});

describe('ConnectionMeetup error rendering', () => {
  it('does not leave an empty-string text child under a View when there is no error', () => {
    const nodes = elements(renderMeetup());
    const views = nodes.filter(node => node.type === 'View');
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) {
      expect(rawChildren(view.props.children).filter(child => typeof child === 'string')).toEqual([]);
    }
    expect(nodes.some(node => node.type === 'Notice')).toBe(false);
  });

  it('retains the Share location button without starting sharing during render', () => {
    const buttons = elements(renderMeetup()).filter(node => node.type === 'Button');
    const share = buttons.find(node => node.props.title === 'Share location for 15 minutes');
    expect(share).toBeDefined();
    expect(share!.props.onPress).toEqual(expect.any(Function));
    expect(share!.props.loading).toBe(false);
    expect(fixture.start).not.toHaveBeenCalled();
    expect(fixture.stop).not.toHaveBeenCalled();
  });

  it('renders a real error inside an error Notice', () => {
    fixture.error = 'Location permission is not active.';
    const notices = elements(renderMeetup()).filter(node => node.type === 'Notice');
    expect(notices).toHaveLength(1);
    expect(notices[0].props).toMatchObject({ error: true, children: fixture.error });
    expect(fixture.start).not.toHaveBeenCalled();
  });
});
