# get_next_word Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreliable 2-tool vocabulary flow (`get_due_words` + `get_vocabulary_word`) with a single smart `get_next_word` tool; simplify the system prompt to a 4-line loop.

**Architecture:** `getNextWord()` in `utils/vocabulary.ts` encapsulates all scheduling logic server-side: returns overdue seen/struggling words first, then new words. The model only ever calls `get_next_word` to get the next card and `update_last_word_review` to rate the response. The 3-phase session indicator is removed from the UI.

**Tech Stack:** Next.js 15, TypeScript, Supabase JS, Vercel AI SDK, Zod, Vitest

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `utils/vocabulary.ts` | Add `getNextWord()` function; extract `trackWordInSession()` helper |
| Modify | `tests/vocabulary.test.ts` | Add tests for `getNextWord` |
| Modify | `utils/ai/index.ts` | Replace `get_due_words` + `get_vocabulary_word` tools with `get_next_word`; remove `update_word_review` (no card_id needed) |
| Modify | `utils/prompts/deutschmeister.ts` | Replace complex prompt with 4-step loop |
| Modify | `tests/deutschmeister.test.ts` | Update assertions for new prompt |
| Modify | `app/Chat.tsx` | Remove `SessionPhaseIndicator` render + phase state |

---

## Task 1: Add `getNextWord` to `utils/vocabulary.ts`

**Files:**
- Modify: `utils/vocabulary.ts`
- Modify: `tests/vocabulary.test.ts`

- [ ] **Step 1: Write failing tests**

  Append to `tests/vocabulary.test.ts` (after the existing describe blocks):

  ```typescript
  describe('getNextWord', () => {
    it('returns due word when seen/struggling word is overdue', async () => {
      // getDueWords path: .in('status', ['seen','struggling']).lte('next_review_at', now)
      mockSingle.mockResolvedValueOnce({
        data: {
          card_id: 'due-1',
          word: 'rot',
          article: '—',
          translation_tr: 'kırmızı',
          example_sentence: 'Rot.',
          topic: 'Renkler',
          pos: 'adjective',
          status: 'seen',
        },
        error: null,
      });

      const result = await getNextWord('user-1');
      expect(result).not.toBeNull();
      expect(result?.card_id).toBe('due-1');
    });

    it('returns new word when no due words exist', async () => {
      // first single() → no due word
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'no rows' } });
      // second single() → new word
      mockSingle.mockResolvedValueOnce({
        data: {
          card_id: 'new-1',
          word: 'blau',
          article: '—',
          translation_tr: 'mavi',
          example_sentence: 'Blau.',
          topic: 'Renkler',
          pos: 'adjective',
          status: 'new',
        },
        error: null,
      });

      const result = await getNextWord('user-1');
      expect(result).not.toBeNull();
      expect(result?.card_id).toBe('new-1');
    });

    it('returns null when no words available', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'no rows' } });
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'no rows' } });

      const result = await getNextWord('user-1');
      expect(result).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  pnpm vitest run tests/vocabulary.test.ts
  ```
  Expected: 3 new tests FAIL — `getNextWord is not a function`

- [ ] **Step 3: Add `getNextWord` to `utils/vocabulary.ts`**

  Add after the existing `getVocabularyWord` function:

  ```typescript
  async function trackWordInSession(
    supabase: Awaited<ReturnType<typeof createClient>>,
    sessionId: string,
    cardId: string
  ): Promise<void> {
    const { data: session } = await supabase
      .from('learning_sessions')
      .select('words_introduced')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (session !== null) {
      const current = session.words_introduced ?? [];
      await supabase
        .from('learning_sessions')
        .update({ words_introduced: [...current, cardId] })
        .eq('session_id', sessionId);
    }
  }

  export async function getNextWord(
    userId: string,
    sessionId?: string
  ): Promise<VocabularyCard | null> {
    const supabase = await createClient();
    const now = new Date().toISOString();

    // 1. Overdue review words first (seen or struggling)
    const { data: dueWord, error: dueError } = await supabase
      .from('vocabulary_cards')
      .select('card_id, word, article, translation_tr, example_sentence, topic, pos, status')
      .eq('user_id', userId)
      .in('status', ['seen', 'struggling'])
      .lte('next_review_at', now)
      .order('next_review_at', { ascending: true })
      .limit(1)
      .single();

    if (!dueError && dueWord) {
      if (sessionId) await trackWordInSession(supabase, sessionId, dueWord.card_id);
      return dueWord as VocabularyCard;
    }

    // 2. New word if no overdue cards
    const { data: newWord, error: newError } = await supabase
      .from('vocabulary_cards')
      .select('card_id, word, article, translation_tr, example_sentence, topic, pos, status')
      .eq('user_id', userId)
      .eq('status', 'new')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (newError || !newWord) return null;

    await supabase
      .from('vocabulary_cards')
      .update({ status: 'seen', last_seen_at: new Date().toISOString() })
      .eq('card_id', newWord.card_id);

    if (sessionId) await trackWordInSession(supabase, sessionId, newWord.card_id);

    return newWord as VocabularyCard;
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  pnpm vitest run tests/vocabulary.test.ts
  ```
  Expected: all 10 tests PASS

- [ ] **Step 5: Commit**

  ```bash
  git add utils/vocabulary.ts tests/vocabulary.test.ts
  git commit -m "feat: add getNextWord — due words first, then new"
  ```

---

## Task 2: Update `utils/ai/index.ts` — replace tools

**Files:**
- Modify: `utils/ai/index.ts`

- [ ] **Step 1: Update imports**

  In `utils/ai/index.ts`, replace the vocabulary import line:

  ```typescript
  import { getNextWord, updateWordReview, updateLastWordReview } from '@/utils/vocabulary';
  ```

- [ ] **Step 2: Replace the tools block**

  Inside `streamText({...})`, replace the entire `tools:` block with:

  ```typescript
  tools: {
    get_next_word: tool({
      description: 'Get the next vocabulary word to teach. Returns an overdue review word first, then a new word. MUST be called before teaching any word.',
      parameters: z.object({}),
      execute: async () => {
        console.log('[tool] get_next_word');
        return getNextWord(userId, conversationId);
      },
    }),
    update_last_word_review: tool({
      description: 'Rate the last word shown after user responds. Call immediately after any user response to a word.',
      parameters: z.object({
        rating: z.number().describe('1=wrong/no idea, 2=hard/needs practice, 3=good/mostly right, 4=easy/perfect'),
      }),
      execute: async ({ rating }) => {
        console.log('[tool] update_last_word_review, rating:', rating);
        return updateLastWordReview(userId, conversationId, rating as 1 | 2 | 3 | 4);
      },
    }),
  },
  ```

- [ ] **Step 3: TypeScript check**

  ```bash
  pnpm tsc --noEmit
  ```
  Expected: only the pre-existing `tests/pdfChat.test.ts` error, nothing new.

- [ ] **Step 4: Commit**

  ```bash
  git add utils/ai/index.ts
  git commit -m "feat: replace get_due_words+get_vocabulary_word with single get_next_word tool"
  ```

---

## Task 3: Simplify system prompt

**Files:**
- Modify: `utils/prompts/deutschmeister.ts`
- Modify: `tests/deutschmeister.test.ts`

- [ ] **Step 1: Update the failing test first**

  In `tests/deutschmeister.test.ts`, replace the `includes the anti-hallucination tool table` test:

  ```typescript
  it('includes the tool loop instructions', () => {
    const prompt = buildDeutschMeisterSystemPrompt(ctx);
    expect(prompt).toContain('get_next_word');
    expect(prompt).toContain('update_last_word_review');
  });
  ```

  Also update the `injects session context` test — the new prompt no longer includes `dueCount` or `lessonTopic` in session plan text, only `knownCount`:

  ```typescript
  it('injects session context', () => {
    const prompt = buildDeutschMeisterSystemPrompt(ctx);
    expect(prompt).toContain('0/650');
  });
  ```

- [ ] **Step 2: Run tests to confirm updated test fails**

  ```bash
  pnpm vitest run tests/deutschmeister.test.ts
  ```
  Expected: `includes the tool loop instructions` FAILS (get_next_word not in prompt yet)

- [ ] **Step 3: Replace the system prompt builder**

  Replace the entire content of `utils/prompts/deutschmeister.ts`:

  ```typescript
  import { SessionContext } from '@/utils/ai/types';

  export type { SessionContext };

  export function buildDeutschMeisterSystemPrompt(ctx: SessionContext): string {
    return `Sen DeutschMeister'sın — Türkçe konuşan A1 Almanca öğrencisine öğretiyorsun.

  ARAÇ KURALLARI (zorunlu, atlama):
  1. Kelime öğretmeden ÖNCE → get_next_word çağır
  2. Öğrenci kelimeye cevap verdikten SONRA → update_last_word_review çağır
     (1=yanlış, 2=zor, 3=iyi, 4=kolay)

  DERS DÖNGÜSÜ:
  get_next_word → kelimeyi öğret → öğrenciden cevap iste → update_last_word_review → tekrar

  ARTİKEL KURALI:
  Her ismi DAIMA emoji+artikel ile yaz: 🔵 der Hund | 🔴 die Katze | 🟢 das Buch
  Artikelsiz asla yazma.

  Kısa mesajlar. Almanca kelimeler **kalın**.
  Hata varsa önce onayla: "✓ Güzel! Sadece: [doğrusu]"
  Kaygı seviyesi ${ctx.anxietySignal}: low=açık düzelt / medium=nazik / high=sadece doğruyu tekrar et.
  Bilinen kelime: ${ctx.knownCount}/650`.trim();
  }
  ```

- [ ] **Step 4: Run all tests**

  ```bash
  pnpm vitest run tests/vocabulary.test.ts tests/deutschmeister.test.ts
  ```
  Expected: all 19 tests PASS

- [ ] **Step 5: Commit**

  ```bash
  git add utils/prompts/deutschmeister.ts tests/deutschmeister.test.ts
  git commit -m "feat: simplify DeutschMeister prompt to 4-step tool loop"
  ```

---

## Task 4: Remove phase indicator from Chat UI

**Files:**
- Modify: `app/Chat.tsx`

- [ ] **Step 1: Remove phase state and startSession**

  In `app/Chat.tsx`, remove these two state declarations (around line 271–272):

  ```typescript
  // DELETE these two lines:
  const [sessionPhase, setSessionPhase] = useState<'warmup' | 'lesson' | 'conversation' | null>(null);
  const [sessionTopic, setSessionTopic] = useState<string>('');
  ```

  Remove the `startSession` function (around lines 510–523):

  ```typescript
  // DELETE this entire function:
  const startSession = async (convId: string) => {
    try {
      const res = await fetch('/api/session/start', { ... });
      const data = await res.json();
      setSessionPhase('warmup');
      setSessionTopic(data.lessonTopic ?? '');
    } catch {
      // non-critical — session tracking fails silently
    }
  };
  ```

  In `addChat()`, remove the `startSession` call (around line 547–549):

  ```typescript
  // DELETE these lines inside addChat():
  if (newConversation?.conversationId) {
    startSession(newConversation.conversationId);
  }
  ```

- [ ] **Step 2: Remove SessionPhaseIndicator from JSX**

  Remove the import at the top:

  ```typescript
  // DELETE:
  import SessionPhaseIndicator from '@/components/SessionPhaseIndicator';
  ```

  Remove the render in JSX (around line 1016):

  ```tsx
  // DELETE:
  <SessionPhaseIndicator phase={sessionPhase} lessonTopic={sessionTopic} />
  ```

- [ ] **Step 3: TypeScript check**

  ```bash
  pnpm tsc --noEmit
  ```
  Expected: only pre-existing `pdfChat.test.ts` error.

- [ ] **Step 4: Commit**

  ```bash
  git add app/Chat.tsx
  git commit -m "chore: remove phase indicator — single-loop session flow"
  ```

---

## Task 5: Smoke test

- [ ] **Step 1: Run full test suite**

  ```bash
  pnpm vitest run
  ```
  Expected: all tests pass (excluding pre-existing pdfChat.test.ts error).

- [ ] **Step 2: Manual chat test**

  With the dev server running (`pnpm dev`), open http://localhost:3000, start a new chat.

  Send: `"Merhaba!"`. Check server log (`tail -f /tmp/nextjs.log`).

  Expected log:
  ```
  [tool] get_next_word
  [respond] tool-call: get_next_word {}
  [respond] tool-result: get_next_word {"card_id":"...","word":"..."}
  ```

  Reply to the word. Expected log:
  ```
  [tool] update_last_word_review, rating: 3
  ```

- [ ] **Step 3: Final commit**

  ```bash
  git add -A
  git commit -m "feat: complete get_next_word simplification — single tool loop"
  ```
