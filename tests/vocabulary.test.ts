import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  // A chainable builder that is also thenable (awaitable)
  const chainable: Record<string, any> = {};

  // Default: awaiting chainable resolves to {data: null, error: null}
  chainable.then = vi.fn((resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve));

  ['select', 'eq', 'lte', 'order', 'limit', 'single', 'update', 'in', 'not', 'upsert'].forEach((m) => {
    chainable[m] = vi.fn().mockReturnValue(chainable);
  });

  return { chainable };
});

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    from: vi.fn().mockReturnValue(mocks.chainable),
  }),
}));

import { getVocabularyWord, getDueWords, updateWordReview } from '@/utils/vocabulary';

beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish chainable return values after clearAllMocks resets them
  ['select', 'eq', 'lte', 'order', 'limit', 'single', 'update', 'in', 'not', 'upsert'].forEach((m) => {
    mocks.chainable[m].mockReturnValue(mocks.chainable);
  });
  mocks.chainable.then.mockImplementation((resolve: any) =>
    Promise.resolve({ data: null, error: null }).then(resolve)
  );
});

describe('getVocabularyWord', () => {
  it('returns a word from DB for given level', async () => {
    mocks.chainable.single.mockResolvedValueOnce({
      data: {
        card_id: 'abc',
        word: 'Hallo',
        article: '—',
        translation_tr: 'Merhaba',
        example_sentence: 'Hallo!',
        topic: 'Selamlaşma',
        pos: 'interjection',
        status: 'new',
      },
      error: null,
    });

    const result = await getVocabularyWord('user-1', 'A1');
    expect(result).not.toBeNull();
    expect(result?.word).toBe('Hallo');
  });

  it('returns null when no words available', async () => {
    mocks.chainable.single.mockResolvedValueOnce({ data: null, error: { message: 'no rows' } });
    const result = await getVocabularyWord('user-1', 'A1');
    expect(result).toBeNull();
  });
});

describe('getDueWords', () => {
  it('returns array of due cards', async () => {
    mocks.chainable.limit.mockResolvedValueOnce({
      data: [
        { card_id: 'a', word: 'rot', article: '—', translation_tr: 'kırmızı', example_sentence: 'Rot.', topic: 'Renkler', pos: 'adjective', status: 'seen' },
      ],
      error: null,
    });

    const result = await getDueWords('user-1', 8);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].word).toBe('rot');
  });

  it('returns empty array on error', async () => {
    mocks.chainable.limit.mockResolvedValueOnce({ data: null, error: { message: 'error' } });
    const result = await getDueWords('user-1', 8);
    expect(result).toEqual([]);
  });
});

describe('updateWordReview', () => {
  it('sets status to struggling for rating 1', async () => {
    mocks.chainable.single.mockResolvedValueOnce({ data: { seen_count: 2 }, error: null });

    const result = await updateWordReview('card-1', 1);
    expect(result.status).toBe('struggling');
  });

  it('sets status to seen for rating 3', async () => {
    mocks.chainable.single.mockResolvedValueOnce({ data: { seen_count: 1 }, error: null });

    const result = await updateWordReview('card-1', 3);
    expect(result.status).toBe('seen');
  });

  it('sets status to known for rating 4', async () => {
    mocks.chainable.single.mockResolvedValueOnce({ data: { seen_count: 3 }, error: null });

    const result = await updateWordReview('card-1', 4);
    expect(result.status).toBe('known');
  });
});
