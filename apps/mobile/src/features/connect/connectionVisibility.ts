import type { Connection } from '@/lib/types';

export function isMutuallyAccepted(item: Connection) {
  return item.status === 'accepted' && item.requester_decision === 'accepted' && item.recipient_decision === 'accepted';
}

export function isPendingInvitation(item: Connection, userId: string, now = Date.now()) {
  return (item.requester_id === userId || item.recipient_id === userId)
    && item.status === 'pending'
    && ['pending', 'accepted'].includes(item.requester_decision)
    && ['pending', 'accepted'].includes(item.recipient_decision)
    && (item.requester_decision === 'pending' || item.recipient_decision === 'pending')
    && Date.parse(item.expires_at) > now;
}
