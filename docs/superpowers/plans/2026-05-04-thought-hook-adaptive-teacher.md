# DeutschMeister Adaptive Teacher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mechanical drill loop with a two-pass adaptive teacher: a Thought Hook observer runs before each response to determine teaching mode/technique, then the main teacher executes that technique — plus FSRS scheduling.

**Architecture:** Every user message triggers (1) a fast `gemini-2.0-flash` observer call that outputs structured JSON (`ThoughtHookOutput`) from conversation history + learner profile, then (2) the existing `gemini-2.5-flash` teacher call with that JSON injected as `<teacher_guidance>`. The rigid 4-step loop instruction is removed from the system prompt.

**Tech Stack:** Next.js 15, Vercel AI SDK (`generateText`, `streamText`), Supabase, `ts-fsrs` npm package, Vitest, TypeScript.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `utils/vocabulary.ts` | Modify | Replace fixed-interval `updateWordReview` with FSRS |
| `utils/ai/types.ts` | Modify | Add `ThoughtHookOutput` type, extend `SessionContext` |
| `utils/ai.ts` | Modify | Add `GEMINI_OBSERVER_MODEL` constant |
| `utils/db/learner-profile.ts` | Create | Read/write `learner_profiles` table |
| `utils/prompts/thought-observer.ts` | Create | Observer system prompt (produces ThoughtHookOutput JSON) |
| `utils/ai/thought.ts` | Create | `runThoughtHook()` — calls observer LLM, returns ThoughtHookOutput |
| `utils/prompts/deutschmeister.ts` | Modify | Remove rigid loop, accept + inject ThoughtHookOutput |
| `utils/sessions.ts` | Modify | Load learner profile, include in SessionContext |
| `utils/ai/index.ts` | Modify | Call runThoughtHook before streamText; update DB after turn |
| `tests/vocabulary.test.ts` | Modify | Update updateWordReview tests for FSRS |
| `tests/thought-hook.test.ts` | Create | Tests for runThoughtHook + learner-profile utils |
| Supabase migration | Apply | `learner_profiles` table + `drill_count_since_conversation` column |

---

## Task 1: Install ts-fsrs + FSRS updateWordReview

**Files:**
- Modify: `utils/vocabulary.ts:174-213`
- Modify: `tests/vocabulary.test.ts:86-107`

- [ ] **Step 1: Install ts-fsrs**

```bash
cd "/Users/ilamedya/Desktop/German Tutor"
pnpm add ts-fsrs
```

Expected: ts-fsrs appears in package.json dependencies.

- [ ] **Step 2: Update the failing tests for updateWordReview**

Replace the existing `describe('updateWordReview', ...)` block in `tests/vocabulary.test.ts` (lines 86–107) with:

```typescript
describe('updateWordReview', () => {
  it('returns struggling status for rating 1', async () => {
    mocks.chainable.single.mockResolvedValueOnce({
      data: {
        stability: 0,
        difficulty: 5,
        elapsed_days: 0,
        reps: 0,
        lapses: 0,
        state: 0,
        last_seen_at: null,
      },
      error: null,
    });

    const result = await updateWordReview('card-1', 1);
    expect(result.status).toBe('struggling');
    expect(typeof result.next_review_at).toBe('string');
  });

  it('returns seen status for rating 3', async () => {
    mocks.chainable.single.mockResolvedValueOnce({
      data: {
        stability: 2,
        difficulty: 5,
        elapsed_days: 3,
        reps: 1,
        lapses: 0,
        state: 2,
        last_seen_at: new Date().toISOString(),
      },
      error: null,
    });

    const result = await updateWordReview('card-1', 3);
    expect(result.status).toBe('seen');
    expect(typeof result.next_review_at).toBe('string');
  });

  it('returns known status for rating 4', async () => {
    mocks.chainable.single.mockResolvedValueOnce({
      data: {
        stability: 4,
        difficulty: 4,
        elapsed_days: 7,
        reps: 2,
        lapses: 0,
        state: 2,
        last_seen_at: new Date().toISOString(),
      },
      error: null,
    });

    const result = await updateWordReview('card-1', 4);
    expect(result.status).toBe('known');
  });

  it('falls back to new card when DB has no FSRS data', async () => {
    mocks.chainable.single.mockResolvedValueOnce({
      data: { stability: null, difficulty: null, elapsed_days: null, reps: null, lapses: null, state: null, last_seen_at: null },
      error: null,
    });

    const result = await updateWordReview('card-1', 3);
    expect(result.status).toBe('seen');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd "/Users/ilamedya/Desktop/German Tutor"
pnpm test tests/vocabulary.test.ts 2>&1 | grep -E "FAIL|PASS|updateWordReview"
```

Expected: `updateWordReview` tests FAIL (old implementation doesn't use FSRS).

- [ ] **Step 4: Replace updateWordReview with FSRS implementation**

In `utils/vocabulary.ts`, replace the entire `updateWordReview` function (lines 174–213) with:

```typescript
import { fsrs, generatorParameters, Rating, createEmptyCard, type Card as FSRSCard } from 'ts-fsrs';

const f = fsrs(generatorParameters());

const ratingMap: Record<1 | 2 | 3 | 4, Rating> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

const statusMap: Record<Rating, 'struggling' | 'seen' | 'known'> = {
  [Rating.Again]: 'struggling',
  [Rating.Hard]: 'struggling',
  [Rating.Good]: 'seen',
  [Rating.Easy]: 'known',
};

export async function updateWordReview(
  wordId: string,
  rating: 1 | 2 | 3 | 4
): Promise<{ next_review_at: string; status: string }> {
  const supabase = await createClient();

  const { data: current } = await supabase
    .from('vocabulary_cards')
    .select('stability, difficulty, elapsed_days, reps, lapses, state, last_seen_at, seen_count')
    .eq('card_id', wordId)
    .single();

  // Build FSRS card from DB row, or start fresh if no FSRS data yet
  const fsrsCard: FSRSCard = (current?.stability != null)
    ? {
        due: new Date(),
        stability: current.stability,
        difficulty: current.difficulty,
        elapsed_days: current.elapsed_days ?? 0,
        scheduled_days: 0,
        reps: current.reps ?? 0,
        lapses: current.lapses ?? 0,
        state: current.state ?? 0,
        last_review: current.last_seen_at ? new Date(current.last_seen_at) : undefined,
      }
    : createEmptyCard();

  const fsrsRating = ratingMap[rating];
  const scheduling = f.repeat(fsrsCard, new Date());
  const newCard = scheduling[fsrsRating].card;
  const newStatus = statusMap[fsrsRating];
  const next_review_at = newCard.due.toISOString();

  await supabase.from('vocabulary_cards').update({
    status: newStatus,
    last_seen_at: new Date().toISOString(),
    next_review_at,
    stability: newCard.stability,
    difficulty: newCard.difficulty,
    elapsed_days: newCard.elapsed_days,
    reps: newCard.reps,
    lapses: newCard.lapses,
    state: newCard.state,
    seen_count: (current?.seen_count ?? 0) + 1,
  }).eq('card_id', wordId);

  return { next_review_at, status: newStatus };
}
```

Also add the import at the top of `utils/vocabulary.ts` alongside the existing imports:

```typescript
import { fsrs, generatorParameters, Rating, createEmptyCard, type Card as FSRSCard } from 'ts-fsrs';
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd "/Users/ilamedya/Desktop/German Tutor"
pnpm test tests/vocabulary.test.ts 2>&1 | grep -E "FAIL|PASS|✓|✗"
```

Expected: All vocabulary tests PASS.

- [ ] **Step 6: Commit**

```bash
git add utils/vocabulary.ts tests/vocabulary.test.ts package.json pnpm-lock.yaml
git commit -m "feat: replace fixed SRS intervals with FSRS algorithm (ts-fsrs)"
```

---

## Task 2: Supabase Migration

**Files:**
- Apply via Supabase MCP

- [ ] **Step 1: Apply learner_profiles table migration**

Run via `mcp__supabase__apply_migration` with name `add_learner_profiles`:

```sql
create table if not exists learner_profiles (
  user_id        uuid primary key references auth.users on delete cascade,
  error_patterns jsonb    not null default '{}',
  session_notes  text     not null default '',
  avg_rating     numeric  not null default 3.0,
  updated_at     timestamptz not null default now()
);

alter table learner_profiles enable row level security;

create policy "Users can read own profile"
  on learner_profiles for select
  using (auth.uid() = user_id);

create policy "Users can upsert own profile"
  on learner_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on learner_profiles for update
  using (auth.uid() = user_id);
```

- [ ] **Step 2: Apply drill_count column migration**

Run via `mcp__supabase__apply_migration` with name `add_drill_count_to_learning_sessions`:

```sql
alter table learning_sessions
  add column if not exists drill_count_since_conversation int not null default 0;
```

- [ ] **Step 3: Verify tables exist**

Run via `mcp__supabase__execute_sql`:

```sql
select column_name from information_schema.columns
where table_name = 'learner_profiles'
order by ordinal_position;
```

Expected output: `user_id`, `error_patterns`, `session_notes`, `avg_rating`, `updated_at`.

```sql
select column_name from information_schema.columns
where table_name = 'learning_sessions' and column_name = 'drill_count_since_conversation';
```

Expected output: 1 row with `drill_count_since_conversation`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add learner_profiles table and drill_count_since_conversation column"
```

---

## Task 3: Learner Profile Utility

**Files:**
- Create: `utils/db/learner-profile.ts`
- Create: `tests/thought-hook.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/thought-hook.test.ts`:

```typescript
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
    // Verify upsert was called (update with incremented count)
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "/Users/ilamedya/Desktop/German Tutor"
pnpm test tests/thought-hook.test.ts 2>&1 | grep -E "FAIL|PASS|Cannot find"
```

Expected: FAIL with module not found errors.

- [ ] **Step 3: Create utils/db/ directory and learner-profile.ts**

Create `utils/db/learner-profile.ts`:

```typescript
import { createClient } from '@/utils/supabase/server';

export interface LearnerProfile {
  user_id: string;
  error_patterns: Record<string, number>;
  session_notes: string;
  avg_rating: number;
}

const DEFAULT_PROFILE: Omit<LearnerProfile, 'user_id'> = {
  error_patterns: {},
  session_notes: '',
  avg_rating: 3.0,
};

export async function getLearnerProfile(userId: string): Promise<LearnerProfile> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('learner_profiles')
    .select('user_id, error_patterns, session_notes, avg_rating')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return { user_id: userId, ...DEFAULT_PROFILE };
  return {
    user_id: data.user_id,
    error_patterns: (data.error_patterns as Record<string, number>) ?? {},
    session_notes: data.session_notes ?? '',
    avg_rating: data.avg_rating ?? 3.0,
  };
}

export async function updateErrorPattern(
  userId: string,
  errorType: string
): Promise<void> {
  const supabase = await createClient();
  const profile = await getLearnerProfile(userId);
  const updated = {
    ...profile.error_patterns,
    [errorType]: (profile.error_patterns[errorType] ?? 0) + 1,
  };
  await supabase
    .from('learner_profiles')
    .upsert(
      { user_id: userId, error_patterns: updated, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
}

export async function upsertLearnerProfile(
  userId: string,
  patch: Partial<Omit<LearnerProfile, 'user_id'>>
): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from('learner_profiles')
    .upsert(
      { user_id: userId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
}

export async function updateDrillCount(
  sessionId: string,
  isConversationTurn: boolean
): Promise<void> {
  const supabase = await createClient();
  if (isConversationTurn) {
    await supabase
      .from('learning_sessions')
      .update({ drill_count_since_conversation: 0 })
      .eq('session_id', sessionId);
  } else {
    const { data } = await supabase
      .from('learning_sessions')
      .select('drill_count_since_conversation')
      .eq('session_id', sessionId)
      .maybeSingle();
    const current = data?.drill_count_since_conversation ?? 0;
    await supabase
      .from('learning_sessions')
      .update({ drill_count_since_conversation: current + 1 })
      .eq('session_id', sessionId);
  }
}

export async function getDrillCount(sessionId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('learning_sessions')
    .select('drill_count_since_conversation')
    .eq('session_id', sessionId)
    .maybeSingle();
  return data?.drill_count_since_conversation ?? 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "/Users/ilamedya/Desktop/German Tutor"
pnpm test tests/thought-hook.test.ts 2>&1 | grep -E "FAIL|PASS|✓|✗"
```

Expected: All learner profile tests PASS.

- [ ] **Step 5: Commit**

```bash
git add utils/db/learner-profile.ts tests/thought-hook.test.ts
git commit -m "feat: add learner-profile utility (error patterns, drill count)"
```

---

## Task 4: ThoughtHookOutput Type + Observer Model Constant

**Files:**
- Modify: `utils/ai/types.ts`
- Modify: `utils/ai.ts`

- [ ] **Step 1: Add ThoughtHookOutput to utils/ai/types.ts**

Append to `utils/ai/types.ts` (after the existing `SessionContext` interface):

```typescript
export type TeachingMode = 'drill' | 'conversation' | 'sentence_production' | 'grammar_note';
export type TeachingTechnique = 'tr_to_de' | 'de_to_tr' | 'fill_blank' | 'make_sentence' | 'free_chat' | 'error_correction';
export type DifficultySignal = 'too_easy' | 'optimal' | 'too_hard';
export type ErrorType = 'article' | 'verb_conjugation' | 'word_order' | 'vocabulary';

export interface ThoughtHookOutput {
  mode: TeachingMode;
  technique: TeachingTechnique;
  difficulty_signal: DifficultySignal;
  error_spotted: ErrorType | null;
  drill_count: number;
  teaching_note: string;
}

export const THOUGHT_HOOK_FALLBACK: ThoughtHookOutput = {
  mode: 'drill',
  technique: 'tr_to_de',
  difficulty_signal: 'optimal',
  error_spotted: null,
  drill_count: 0,
  teaching_note: 'Başlangıç: kelime çalışmasıyla başla.',
};
```

- [ ] **Step 2: Add GEMINI_OBSERVER_MODEL to utils/ai.ts**

Find `export const GEMINI_MODEL = 'gemini-2.5-flash';` in `utils/ai.ts` and add below it:

```typescript
export const GEMINI_OBSERVER_MODEL = 'gemini-2.0-flash';
```

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```bash
cd "/Users/ilamedya/Desktop/German Tutor"
pnpm test 2>&1 | tail -5
```

Expected: All existing tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add utils/ai/types.ts utils/ai.ts
git commit -m "feat: add ThoughtHookOutput type and observer model constant"
```

---

## Task 5: Observer Prompt + Thought Hook LLM Call

**Files:**
- Create: `utils/prompts/thought-observer.ts`
- Create: `utils/ai/thought.ts`
- Modify: `tests/thought-hook.test.ts`

- [ ] **Step 1: Create the observer system prompt**

Create `utils/prompts/thought-observer.ts`:

```typescript
export function buildObserverPrompt(
  drillCount: number,
  errorPatterns: Record<string, number>,
  sessionNotes: string
): string {
  const topErrors = Object.entries(errorPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') || 'none';

  return `Sen bir dil öğretimi analistisin. Konuşma geçmişini analiz et ve SADECE JSON döndür — başka hiçbir şey yazma.

Mevcut oturum bilgileri:
- Son konuşmadan bu yana yapılan drill sayısı: ${drillCount}
- Birikmiş hata profili: ${topErrors}
- Öğretmen notları: ${sessionNotes || 'yok'}

Karar kuralları:
- drill_count >= 3 → mode: "sentence_production" veya "conversation" öner
- Son 3 mesajdaki ratingler ortalaması > 3.5 → difficulty_signal: "too_easy"
- Son 3 mesajdaki ratingler ortalaması < 2.0 → difficulty_signal: "too_hard"
- Aksi halde → difficulty_signal: "optimal"
- Eğer öğrenci artikel hatası yaptıysa → error_spotted: "article"
- Eğer fiil çekimi hatası yaptıysa → error_spotted: "verb_conjugation"

Döndüreceğin JSON şeması (bu şemadan sapma):
{
  "mode": "drill" | "conversation" | "sentence_production" | "grammar_note",
  "technique": "tr_to_de" | "de_to_tr" | "fill_blank" | "make_sentence" | "free_chat" | "error_correction",
  "difficulty_signal": "too_easy" | "optimal" | "too_hard",
  "error_spotted": "article" | "verb_conjugation" | "word_order" | "vocabulary" | null,
  "drill_count": ${drillCount},
  "teaching_note": "öğretmen için 1 cümle talimat (Türkçe)"
}`;
}
```

- [ ] **Step 2: Add thought hook tests to tests/thought-hook.test.ts**

Add this `describe` block at the end of `tests/thought-hook.test.ts` (after the existing learner profile tests):

```typescript
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
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd "/Users/ilamedya/Desktop/German Tutor"
pnpm test tests/thought-hook.test.ts 2>&1 | grep -E "FAIL|runThoughtHook"
```

Expected: FAIL with module not found for `@/utils/ai/thought`.

- [ ] **Step 4: Create utils/ai/thought.ts**

```typescript
import { generateText } from 'ai';
import { googleAI, GEMINI_OBSERVER_MODEL } from '@/utils/ai';
import { ThoughtHookOutput, THOUGHT_HOOK_FALLBACK } from '@/utils/ai/types';
import { buildObserverPrompt } from '@/utils/prompts/thought-observer';

interface ThoughtHookInput {
  recentMessages: { role: 'user' | 'assistant'; content: string }[];
  drillCount: number;
  errorPatterns: Record<string, number>;
  sessionNotes: string;
}

const VALID_MODES = new Set(['drill', 'conversation', 'sentence_production', 'grammar_note']);
const VALID_TECHNIQUES = new Set(['tr_to_de', 'de_to_tr', 'fill_blank', 'make_sentence', 'free_chat', 'error_correction']);
const VALID_DIFFICULTY = new Set(['too_easy', 'optimal', 'too_hard']);
const VALID_ERRORS = new Set(['article', 'verb_conjugation', 'word_order', 'vocabulary', null]);

function isValidOutput(obj: unknown): obj is ThoughtHookOutput {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    VALID_MODES.has(o.mode as string) &&
    VALID_TECHNIQUES.has(o.technique as string) &&
    VALID_DIFFICULTY.has(o.difficulty_signal as string) &&
    VALID_ERRORS.has(o.error_spotted as string | null) &&
    typeof o.drill_count === 'number' &&
    typeof o.teaching_note === 'string'
  );
}

export async function runThoughtHook(input: ThoughtHookInput): Promise<ThoughtHookOutput> {
  try {
    const systemPrompt = buildObserverPrompt(
      input.drillCount,
      input.errorPatterns,
      input.sessionNotes
    );

    const conversationText = input.recentMessages
      .slice(-6)
      .map((m) => `${m.role === 'user' ? 'Öğrenci' : 'Öğretmen'}: ${m.content}`)
      .join('\n');

    const { text } = await generateText({
      model: googleAI(GEMINI_OBSERVER_MODEL),
      system: systemPrompt,
      prompt: conversationText || 'Konuşma henüz başlamadı.',
      maxTokens: 200,
    });

    // Strip markdown code fences if present
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!isValidOutput(parsed)) return THOUGHT_HOOK_FALLBACK;
    return parsed;
  } catch {
    return THOUGHT_HOOK_FALLBACK;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd "/Users/ilamedya/Desktop/German Tutor"
pnpm test tests/thought-hook.test.ts 2>&1 | grep -E "FAIL|PASS|✓|✗"
```

Expected: All thought-hook tests PASS.

- [ ] **Step 6: Commit**

```bash
git add utils/prompts/thought-observer.ts utils/ai/thought.ts tests/thought-hook.test.ts
git commit -m "feat: add Thought Hook observer (runThoughtHook + observer prompt)"
```

---

## Task 6: Redesign System Prompt

**Files:**
- Modify: `utils/prompts/deutschmeister.ts`
- Modify: `utils/ai/types.ts` (extend SessionContext)

- [ ] **Step 1: Extend SessionContext with ThoughtHookOutput**

In `utils/ai/types.ts`, update the `SessionContext` interface to include the thought hook output:

```typescript
export interface SessionContext {
  lessonTopic: string;
  lastTopic: string | null;
  knownCount: number;
  dueCount: number;
  anxietySignal: 'low' | 'medium' | 'high';  // kept for backward compat, will be removed later
  thoughtHook?: ThoughtHookOutput;            // undefined on first message (no history yet)
}
```

- [ ] **Step 2: Run existing prompt tests to confirm they still pass**

```bash
cd "/Users/ilamedya/Desktop/German Tutor"
pnpm test tests/deutschmeister.test.ts 2>&1 | grep -E "FAIL|PASS"
```

Expected: All existing prompt tests PASS (thoughtHook is optional, no breaking change).

- [ ] **Step 3: Rewrite buildDeutschMeisterSystemPrompt**

Replace the entire content of `utils/prompts/deutschmeister.ts`:

```typescript
import { SessionContext, ThoughtHookOutput } from '@/utils/ai/types';

export type { SessionContext };

function buildTeacherGuidance(hook: ThoughtHookOutput): string {
  const errorFocus = hook.error_spotted
    ? `\nERROR_FOCUS: ${hook.error_spotted} — bu hatayı bu turda ele al`
    : '';
  return `<teacher_guidance>
MODE: ${hook.mode}
TECHNIQUE: ${hook.technique}
DIFFICULTY: ${hook.difficulty_signal}${errorFocus}
NOTE: ${hook.teaching_note}
</teacher_guidance>`;
}

const TECHNIQUE_HINTS: Record<string, string> = {
  tr_to_de: 'Türkçe anlamı ver, Almancasını + artiklini iste.',
  de_to_tr: 'Almanca kelimeyi ver, Türkçe anlamını iste.',
  fill_blank: 'Kelimeyi içeren bir cümle yaz, kelimeyi ___ ile değiştir.',
  make_sentence: '"Bu kelimeyi kullanarak bir cümle kur" de.',
  free_chat: 'Bilinen kelimelerle 2-3 tur Almanca sohbet başlat. update_last_word_review ÇAĞIRMA.',
  error_correction: 'Önce hatayı nazikçe düzelt, sonra devam et.',
};

export function buildDeutschMeisterSystemPrompt(ctx: SessionContext): string {
  const basePrompt = `Sen DeutschMeister'sın — Türkçe konuşan A1 öğrencisine özel Almanca öğretmeni.

ARAÇLARIN:
- get_next_word: Sıradaki kelimeyi getir. Drill modunda NE ZAMAN çağıracağına sen karar ver.
- update_last_word_review: Drill sonrası öğrencinin cevabını puanla (1-4). Sohbet/cümle modunda ÇAĞIRMA.

ARTİKEL KURALI: 🔵 der Hund | 🔴 die Katze | 🟢 das Buch — artikelsiz asla yazma.
HATA DÜZELTMESİ: "✓ Güzel! Sadece: [doğrusu]"
Bilinen kelime: ${ctx.knownCount}/650`.trim();

  if (!ctx.thoughtHook) {
    // First message — no history to observe, start with a drill
    return basePrompt + `\n\n<teacher_guidance>
MODE: drill
TECHNIQUE: tr_to_de
DIFFICULTY: optimal
NOTE: İlk mesaj. get_next_word ile başla, sıcak bir karşılama yap.
</teacher_guidance>`;
  }

  const techniqueHint = TECHNIQUE_HINTS[ctx.thoughtHook.technique] ?? '';
  const guidance = buildTeacherGuidance(ctx.thoughtHook);
  return `${basePrompt}\n\nTEKNİK İPUCU (${ctx.thoughtHook.technique}): ${techniqueHint}\n\n${guidance}`;
}
```

- [ ] **Step 4: Update prompt tests for new signature**

In `tests/deutschmeister.test.ts`, the existing tests check for `get_next_word`, `update_last_word_review`, article colors, and context injection. Update the `injects session context` test to match the new prompt:

```typescript
it('injects session context', () => {
  const prompt = buildDeutschMeisterSystemPrompt(ctx);
  expect(prompt).toContain('0/650');
});

it('includes teacher_guidance block when thoughtHook provided', () => {
  const ctxWithHook: SessionContext = {
    ...ctx,
    thoughtHook: {
      mode: 'conversation',
      technique: 'free_chat',
      difficulty_signal: 'optimal',
      error_spotted: null,
      drill_count: 3,
      teaching_note: 'Sohbet aç.',
    },
  };
  const prompt = buildDeutschMeisterSystemPrompt(ctxWithHook);
  expect(prompt).toContain('<teacher_guidance>');
  expect(prompt).toContain('MODE: conversation');
  expect(prompt).toContain('TECHNIQUE: free_chat');
});

it('uses default drill guidance when thoughtHook is undefined', () => {
  const prompt = buildDeutschMeisterSystemPrompt(ctx); // ctx has no thoughtHook
  expect(prompt).toContain('MODE: drill');
  expect(prompt).toContain('İlk mesaj');
});
```

- [ ] **Step 5: Run all tests**

```bash
cd "/Users/ilamedya/Desktop/German Tutor"
pnpm test 2>&1 | tail -10
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add utils/prompts/deutschmeister.ts utils/ai/types.ts tests/deutschmeister.test.ts
git commit -m "feat: redesign system prompt with teacher_guidance injection, remove rigid loop"
```

---

## Task 7: Wire Thought Hook into respond()

**Files:**
- Modify: `utils/ai/index.ts`
- Modify: `utils/sessions.ts`

- [ ] **Step 1: Update sessions.ts to load learner profile**

In `utils/sessions.ts`, add the import and extend `getSessionContext`:

```typescript
import { createClient } from '@/utils/supabase/server';
import { SessionContext } from '@/utils/ai/types';
import { getNextLessonTopic } from '@/utils/lessons';
import { getLearnerProfile, getDrillCount } from '@/utils/db/learner-profile';

export async function getSessionContext(
  userId: string,
  conversationId: string
): Promise<SessionContext & { learnerProfile: Awaited<ReturnType<typeof getLearnerProfile>>; drillCount: number }> {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const [sessionResult, lastSessionResult, knownResult, dueResult, learnerProfile, drillCount] = await Promise.all([
    supabase.from('learning_sessions').select('lesson_topic').eq('session_id', conversationId).single(),
    supabase.from('learning_sessions').select('lesson_topic').eq('user_id', userId).not('ended_at', 'is', null).order('ended_at', { ascending: false }).limit(1).single(),
    supabase.from('vocabulary_cards').select('*', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['seen', 'known']),
    supabase.from('vocabulary_cards').select('*', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['seen', 'struggling']).lte('next_review_at', now),
    getLearnerProfile(userId),
    getDrillCount(conversationId),
  ]);

  const lastTopic = lastSessionResult.data?.lesson_topic ?? null;
  const lessonTopic = sessionResult.data?.lesson_topic ?? getNextLessonTopic(lastTopic);

  return {
    lessonTopic,
    lastTopic,
    knownCount: knownResult.count ?? 0,
    dueCount: dueResult.count ?? 0,
    anxietySignal: 'medium',
    learnerProfile,
    drillCount,
  };
}
```

- [ ] **Step 2: Update respond() in utils/ai/index.ts**

Replace the entire `utils/ai/index.ts` with:

```typescript
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { ChatCallProps } from './types';
import { formatStreamChunk } from '@/utils/ai/stream';
import { validateUser } from '@/utils/ai/validation';
import { fetchConversationHistory, saveConversation } from '@/utils/ai/conversation';
import { checkAndGenerateSummary } from '@/utils/ai/summary';
import { googleAI, GEMINI_MODEL } from '@/utils/ai';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { getNextWord, updateLastWordReview } from '@/utils/vocabulary';
import { getSessionContext } from '@/utils/sessions';
import { buildDeutschMeisterSystemPrompt } from '@/utils/prompts/deutschmeister';
import { runThoughtHook } from '@/utils/ai/thought';
import { updateErrorPattern, updateDrillCount } from '@/utils/db/learner-profile';

const SENTRY_RELEASE = process.env.SENTRY_RELEASE || 'dev';
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || 'local';

export async function* respond({ message, conversationId }: ChatCallProps) {
  console.log('[respond] start, model:', GEMINI_MODEL);
  const userValidation = await validateUser();
  if (!userValidation.isAuthorized) {
    return new NextResponse(userValidation.error, { status: userValidation.status });
  }
  const { userData } = userValidation;
  if (!userData) return new NextResponse('User data not found', { status: 500 });

  const { userId } = userData;
  console.log('[respond] userId:', userId.slice(0, 8) + '...');

  const [{ messages: messageHistory, summaries: summaryHistory }, sessionCtx] =
    await Promise.all([
      fetchConversationHistory('', userId, conversationId),
      getSessionContext(userId, conversationId),
    ]);

  // Pass 1: Thought Hook (skip on first message — no history to observe)
  let thoughtHook = undefined;
  if (messageHistory.length >= 2) {
    const recentMessages = messageHistory.slice(-6).map((m) => ({
      role: m.is_user ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));
    thoughtHook = await runThoughtHook({
      recentMessages,
      drillCount: sessionCtx.drillCount,
      errorPatterns: sessionCtx.learnerProfile.error_patterns,
      sessionNotes: sessionCtx.learnerProfile.session_notes,
    });
    console.log('[thought-hook]', JSON.stringify(thoughtHook));
  }

  const sessionContext = { ...sessionCtx, thoughtHook };

  const conversationMessages = messageHistory.map((m) => ({
    role: m.is_user ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }));
  conversationMessages.push({ role: 'user', content: message });

  const lastSummary = summaryHistory[0]?.content;
  let response = '';

  after(async () => {
    await saveConversation('', userId, conversationId, message, '', '', '', response);
    await checkAndGenerateSummary('', userId, conversationId, messageHistory, summaryHistory, lastSummary);

    // Update learner profile based on thought hook observations
    if (thoughtHook?.error_spotted) {
      await updateErrorPattern(userId, thoughtHook.error_spotted);
    }
    const isConversationTurn = thoughtHook?.mode === 'conversation' || thoughtHook?.mode === 'sentence_production';
    await updateDrillCount(conversationId, isConversationTurn);
  });

  try {
    const result = streamText({
      model: googleAI(GEMINI_MODEL),
      system: buildDeutschMeisterSystemPrompt(sessionContext),
      messages: conversationMessages,
      maxSteps: 5,
      experimental_telemetry: {
        isEnabled: true,
        metadata: { sessionId: conversationId, userId, release: SENTRY_RELEASE, environment: SENTRY_ENVIRONMENT, tags: ['response'] },
      },
      tools: {
        get_next_word: tool({
          description: 'Get the next vocabulary word to teach. Call during drill mode before introducing a word.',
          parameters: z.object({}),
          execute: async () => {
            console.log('[tool] get_next_word');
            return getNextWord(userId, conversationId);
          },
        }),
        update_last_word_review: tool({
          description: 'Rate the last vocabulary word after student responds during drill mode only. Do NOT call during conversation or sentence_production mode.',
          parameters: z.object({
            rating: z.number().describe('1=wrong, 2=hard, 3=good, 4=easy'),
          }),
          execute: async ({ rating }) => {
            console.log('[tool] update_last_word_review, rating:', rating);
            return updateLastWordReview(userId, conversationId, rating as 1 | 2 | 3 | 4);
          },
        }),
      },
    });

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        response += part.textDelta;
        yield formatStreamChunk({ type: 'response', text: part.textDelta });
      } else if (part.type === 'tool-call') {
        console.log('[respond] tool-call:', part.toolName, JSON.stringify(part.args));
      } else if (part.type === 'tool-result') {
        console.log('[respond] tool-result:', part.toolName, JSON.stringify(part.result).slice(0, 120));
      } else if (part.type === 'error') {
        console.error('[respond] stream error part:', part.error);
      } else if (part.type === 'finish') {
        console.log('[respond] finish, stopReason:', part.finishReason);
      }
    }
  } catch (err) {
    console.error('[respond] fullStream error:', err);
    throw err;
  }
  console.log('[respond] done, thought-hook mode:', thoughtHook?.mode ?? 'none', 'response length:', response.length);

  return new NextResponse(response);
}
```

- [ ] **Step 3: Run all tests**

```bash
cd "/Users/ilamedya/Desktop/German Tutor"
pnpm test 2>&1 | tail -15
```

Expected: All tests PASS. (respond() is not unit-tested — it's an integration layer.)

- [ ] **Step 4: Commit**

```bash
git add utils/ai/index.ts utils/sessions.ts
git commit -m "feat: wire Thought Hook into respond() — two-pass adaptive teacher"
```

---

## Task 8: Smoke Test

**No code changes — manual verification only.**

- [ ] **Step 1: Start dev server**

```bash
cd "/Users/ilamedya/Desktop/German Tutor"
pnpm dev
```

- [ ] **Step 2: Send first message**

Open http://localhost:3001, sign in, create new conversation, send "Merhaba!"

Expected server logs:
```
[respond] start, model: gemini-2.5-flash
[respond] userId: 701786c...
[tool] get_next_word
[respond] finish, stopReason: stop
```
Note: NO `[thought-hook]` log on first message (messageHistory.length < 2).

- [ ] **Step 3: Reply to the first word**

Send a response to the word (correct or incorrect).

Expected server logs:
```
[thought-hook] {"mode":"drill","technique":"...","difficulty_signal":"optimal",...}
[tool] update_last_word_review, rating: 3
```

- [ ] **Step 4: Drill 3 words**

Answer 3 words correctly (rate 3 or 4 each). After the 3rd word response:

Expected: `[thought-hook]` log shows `"mode":"sentence_production"` or `"mode":"conversation"` — teacher transitions away from drill.

- [ ] **Step 5: Verify no hallucinated words**

Check that all words the teacher introduces come from `[tool] get_next_word` calls. If a word appears without a preceding `get_next_word` tool call in logs, that's a hallucination.

- [ ] **Step 6: Final commit if any tweaks needed**

```bash
git add -A
git commit -m "fix: post-smoke-test adjustments"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Two-pass flow (Thought Hook → Teacher): Task 5, 7
- ✅ ThoughtHookOutput JSON schema: Task 4
- ✅ Decision logic (drill_count, desirable difficulty, error focus): Task 5 (observer prompt) + Task 3 (drill count)
- ✅ Fallback on invalid JSON / LLM failure: Task 5 (`isValidOutput` + catch)
- ✅ FSRS integration: Task 1
- ✅ learner_profiles table: Task 2, 3
- ✅ drill_count_since_conversation column: Task 2, 3
- ✅ Error pattern update after turn: Task 7 (`after()` block)
- ✅ System prompt redesign (remove rigid loop, teacher_guidance injection): Task 6
- ✅ update_last_word_review NOT called in conversation mode: Tool description updated in Task 7
- ✅ gemini-2.0-flash for observer, gemini-2.5-flash for teacher: Task 4, 5

**Type consistency check:**
- `ThoughtHookOutput` defined in Task 4 (`utils/ai/types.ts`), used in Task 5 (`thought.ts`), Task 6 (`deutschmeister.ts`), Task 7 (`index.ts`) — consistent.
- `THOUGHT_HOOK_FALLBACK` defined in Task 4, imported in Task 5 tests and `thought.ts` — consistent.
- `getLearnerProfile`, `updateErrorPattern`, `upsertLearnerProfile`, `updateDrillCount`, `getDrillCount` defined in Task 3, used in Task 7 — consistent.
- `SessionContext` extended in Task 6 Step 1 with `thoughtHook?: ThoughtHookOutput` — optional, backward compatible.
