import type { Encounter } from '../../lib/types';
import type { matchingReadiness } from '../profile/matchingReadiness';

export type DiscoveryOutcomes = {
  candidate_count: number;
  pending_count: number;
  insufficient_evidence_count: number;
  not_recommended_count: number;
  unavailable_count: number;
};

type DiscoveryEmptyState = {
  discoveryOn: boolean;
  browserOnly: boolean;
  error?: string;
  modelUnavailable?: boolean;
  pending?: number;
  readiness?: ReturnType<typeof matchingReadiness>;
  bluetoothLive: boolean;
  encounters: Encounter[];
  outcomes?: DiscoveryOutcomes;
};

/** Describe the matching stage without treating a withheld suggestion as a radio failure. */
export function discoveryEmptyState(state: DiscoveryEmptyState) {
  if (!state.discoveryOn) return {
    title: 'Discovery is off.',
    message: state.browserOnly
      ? 'Turn on location above and allow this site to find nearby SidebySide users.'
      : 'Turn on location or Bluetooth above to find nearby SidebySide users.',
  };
  if (state.error) return {
    title: 'Discovery needs attention.',
    message: 'Check the message above, then refresh discoveries.',
  };
  if (state.readiness && !state.readiness.ready) return state.readiness.boundaryReview ? {
    title: 'Match suggestions are paused.',
    message: 'Your topic boundaries are saved. Suggestions remain paused until the matching service can honor them. Review any other matching steps above.',
  } : {
    title: 'Your matching setup needs attention.',
    message: 'Complete the matching steps above in Profile or Settings. Nearby discovery can stay on.',
  };
  // Fresh server outcomes supersede the result captured at the last radio read.
  const encounters = state.bluetoothLive && !state.outcomes ? state.encounters : [];
  if (state.modelUnavailable || state.outcomes?.unavailable_count || encounters.some(encounter => encounter.status === 'unavailable')) return {
    title: 'Matching is temporarily unavailable.',
    message: 'People appear here once the matching service can check their approved profiles. Discovery can stay on while the service is restored.',
  };
  if ((state.outcomes?.pending_count ?? state.pending) || encounters.some(encounter => encounter.status === 'pending')) return {
    title: encounters.length ? 'Nearby phone detected.' : 'Checking nearby matches…',
    message: 'Nearby profiles are being checked. Results update automatically.',
  };
  if (state.outcomes?.insufficient_evidence_count) return {
    title: 'Nearby profiles found.',
    message: 'The matching check needs more approved details to support a conversation. Similar interests alone may not be enough. You can review your goal and matching details in Profile.',
  };
  if (encounters.some(encounter => encounter.status === 'insufficient_evidence')) return {
    title: 'Nearby phone detected.',
    message: 'The matching check could not produce a suggestion from the current approved profiles and preferences.',
  };
  if (state.outcomes?.not_recommended_count) return {
    title: 'No recommended conversation yet.',
    message: 'Nearby profiles were checked, but the model did not recommend a conversation for the current approved details and goals.',
  };
  if (encounters.some(encounter => encounter.status === 'not_recommended')) return {
    title: 'No recommended conversation yet.',
    message: 'A nearby phone was detected. The matching check did not recommend a conversation for the current profiles.',
  };
  return {
    title: 'No recommended matches yet.',
    message: `Other people need SidebySide discovery and preview sharing enabled. Keep ${state.browserOnly ? 'this page' : 'the app'} open; nearby results update automatically.`,
  };
}
