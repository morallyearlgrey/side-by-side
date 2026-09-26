import { expect, it } from 'vitest';
import { pendingReply } from './pendingReply';

const turn = { id: 'saved-answer-id', role: 'user' as const, content: 'I love hiking.', question_key: 'interests', created_at: '2026-09-26T00:00:00Z' };

it('resumes an unanswered persisted turn without changing its identity or content', () => {
  expect(pendingReply({ turns: [turn] })).toEqual({ message_id: turn.id, content: turn.content, skip: false });
});

it('reconstructs the original skip request after restarting the app', () => {
  expect(pendingReply({ turns: [{ ...turn, content: '[Skipped]' }] })).toEqual({ message_id: turn.id, content: '', skip: true });
});

it('allows a new answer once the assistant has replied', () => {
  expect(pendingReply({ turns: [turn, { ...turn, id: 'reply-id', role: 'assistant', content: 'Where do you like hiking?' }] })).toBeNull();
  expect(pendingReply()).toBeNull();
});
