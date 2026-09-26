import { describe, expect, it } from 'vitest';
import type { ConversationRequest } from '../../lib/types';
import { canConfirmConversationRequest, changeConversationGoal, currentConversationRequest } from './conversationRequest';

const request: ConversationRequest = { mode: 'learn', goal: 'Repair a canoe paddle', evidence_requirement: { version: 1, kind: 'firsthand', subject: 'candidate', claim: 'I have repaired a cracked canoe paddle blade.', confirmation: 'confirmed' } };

describe('conversation request approval', () => {
  it('never supplies a default experience requirement for old or mismatched requests', () => {
    expect(currentConversationRequest(null, 'learn', request.goal)).toBeNull();
    expect(currentConversationRequest(request, 'share', request.goal)).toBeNull();
    expect(currentConversationRequest(request, 'learn', 'Build a boat')).toBeNull();
    expect(currentConversationRequest(request, 'learn', request.goal)).toBe(request);
  });
  it('does not resurrect confirmation when a goal is changed and then restored', () => {
    const initial = { current_goal: request.goal, conversation_request: request };
    const changed = changeConversationGoal(initial, 'Build a boat');
    const restored = changeConversationGoal(changed, request.goal);
    expect(restored.conversation_request).toBeNull();
    expect(initial.conversation_request?.evidence_requirement.confirmation).toBe('confirmed');
    expect(changeConversationGoal(initial, request.goal)).toBe(initial);
  });
  it('requires a complete request with the right direction before it can be approved', () => {
    expect(canConfirmConversationRequest(null)).toBe(false);
    expect(canConfirmConversationRequest(request)).toBe(true);
    expect(canConfirmConversationRequest({ ...request, goal: ' ' })).toBe(false);
    expect(canConfirmConversationRequest({ ...request, evidence_requirement: { ...request.evidence_requirement, claim: ' ' } })).toBe(false);
    expect(canConfirmConversationRequest({ ...request, evidence_requirement: { ...request.evidence_requirement, subject: 'viewer' } })).toBe(false);
    expect(canConfirmConversationRequest({ ...request, mode: 'share' })).toBe(false);
    expect(canConfirmConversationRequest({ ...request, mode: 'share', evidence_requirement: { ...request.evidence_requirement, subject: 'viewer' } })).toBe(true);
  });
  it('allows an explicit no-experience request while keeping unresolved requests unconfirmable', () => {
    expect(canConfirmConversationRequest({ ...request, evidence_requirement: { version: 1, kind: 'none', subject: null, claim: null, confirmation: 'pending' } })).toBe(true);
    expect(canConfirmConversationRequest({ ...request, evidence_requirement: { version: 1, kind: 'unresolved', subject: null, claim: null, confirmation: 'pending' } })).toBe(false);
  });
});
