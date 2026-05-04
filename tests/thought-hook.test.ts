import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const chainable: Record<string, any> = {};
  chainable.then = vi.fn((resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve));
  ['select', 'eq', 'single', 'maybeSingle', 'update', 'upsert', 'insert'].forEach((m) => {
    chainable[m] = vi.fn().mockReturnValue(chainable);
  });
  return { chainable };
});

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    from: vi.fn().mockReturnValue(mocks.chainable),
  }),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

import { getLearnerProfile, updateErrorPattern, upsertLearnerProfile } from '@/utils/db/learner-profile';

beforeEach(() => {
  vi.clearAllMocks();
  ['select', 'eq', 'single', 'maybeSingle', 'update', 'upsert', 'insert'].forEach((m) => {
    mocks.chainable[m].mockReturnValue(mocks.chainable);
  });
  mocks.chainable.then.mockImplementation((resolve: any) =>
    Promise.resolve({ data: null, error: null }).then(resolve)
  );
});

describe('getLearnerProfile', () => {
  it('returns profile when found', async () => {
    mocks.chainable.maybeSingle.mockResolvedValueOnce({
      data: { user_id: 'u1', error_patterns: { article: 3 }, session_notes: 'struggles with articles', avg_rating: 2.5 },
      error: null,
    });
    const result = await getLearnerProfile('u1');
    expect(result.error_patterns).toEqual({ article: 3 });
    expect(result.avg_rating).toBe(2.5);
  });

  it('returns default profile when not found', async () => {
    mocks.chainable.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const result = await getLearnerProfile('u1');
    expect(result.error_patterns).toEqual({});
    expect(result.avg_rating).toBe(3.0);
    expect(result.session_notes).toBe('');
  });
});

describe('updateErrorPattern', () => {
  it('increments error count for given error type', async () => {
    mocks.chainable.maybeSingle.mockResolvedValueOnce({
      data: { user_id: 'u1', error_patterns: { article: 2 }, session_notes: '', avg_rating: 3.0 },
      error: null,
    });
    await updateErrorPattern('u1', 'article');
    expect(mocks.chainable.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        error_patterns: { article: 3 },
      }),
      expect.anything()
    );
  });

  it('creates new error type if not present', async () => {
    mocks.chainable.maybeSingle.mockResolvedValueOnce({
      data: { user_id: 'u1', error_patterns: {}, session_notes: '', avg_rating: 3.0 },
      error: null,
    });
    await updateErrorPattern('u1', 'verb_conjugation');
    expect(mocks.chainable.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        error_patterns: { verb_conjugation: 1 },
      }),
      expect.anything()
    );
  });
});

describe('upsertLearnerProfile', () => {
  it('calls upsert with patched fields', async () => {
    await upsertLearnerProfile('u1', { avg_rating: 2.8, session_notes: 'needs help' });
    expect(mocks.chainable.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        avg_rating: 2.8,
        session_notes: 'needs help',
      }),
      expect.anything()
    );
  });
});

import { generateText } from 'ai';
import { runThoughtHook } from '@/utils/ai/thought';
import { THOUGHT_HOOK_FALLBACK } from '@/utils/ai/types';

describe('runThoughtHook', () => {
  it('parses valid JSON response from LLM', async () => {
    const validOutput = {
      mode: 'conversation',
      technique: 'free_chat',
      difficulty_signal: 'optimal',
      error_spotted: null,
      drill_count: 3,
      teaching_note: 'Sohbet aç.',
    };
    vi.mocked(generateText).mockResolvedValueOnce({ text: JSON.stringify(validOutput) } as any);

    const result = await runThoughtHook({
      recentMessages: [{ role: 'user', content: 'Hallo' }],
      drillCount: 3,
      errorPatterns: {},
      sessionNotes: '',
    });

    expect(result.mode).toBe('conversation');
    expect(result.technique).toBe('free_chat');
    expect(result.error_spotted).toBeNull();
  });

  it('returns THOUGHT_HOOK_FALLBACK when LLM returns invalid JSON', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({ text: 'not json at all' } as any);

    const result = await runThoughtHook({
      recentMessages: [],
      drillCount: 0,
      errorPatterns: {},
      sessionNotes: '',
    });

    expect(result).toEqual(THOUGHT_HOOK_FALLBACK);
  });

  it('returns THOUGHT_HOOK_FALLBACK when LLM call throws', async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error('API error'));

    const result = await runThoughtHook({
      recentMessages: [],
      drillCount: 0,
      errorPatterns: {},
      sessionNotes: '',
    });

    expect(result).toEqual(THOUGHT_HOOK_FALLBACK);
  });
});
