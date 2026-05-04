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
