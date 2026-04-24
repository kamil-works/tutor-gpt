# German Tutor Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork Tutor-GPT and transform it into DeutschMeister — a German tutor for Turkish speakers with Gemini 2.0 Flash, tool-enforced vocabulary, and a three-phase daily session flow.

**Architecture:** Tutor-GPT fork (Next.js 14 + Supabase + Honcho). Switch LLM from OpenRouter to Google AI Studio (Gemini 2.0 Flash). Simplify the two-pass thought/response flow to a single-pass flow with tool calling. Add two new Supabase tables (`vocabulary_cards`, `learning_sessions`) and three new API routes.

**Tech Stack:** Next.js 14, TypeScript, Supabase (PostgreSQL), Honcho (cross-session memory), Vercel AI SDK (`ai` + `@ai-sdk/google`), Zod, pnpm, Vitest

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| **Modify** | `utils/ai.ts` | Switch LLM provider from OpenRouter to Google AI Studio (Gemini 2.0 Flash) |
| **Modify** | `utils/ai/index.ts` | Simplify `respond()`: remove thought step, add tool calling with `maxSteps` |
| **Modify** | `utils/ai/types.ts` | Add `SessionContext` interface |
| **Create** | `utils/prompts/deutschmeister.ts` | 4-block DeutschMeister system prompt builder |
| **Create** | `utils/vocabulary.ts` | DB query functions backing the three LLM tools |
| **Create** | `utils/sessions.ts` | `getSessionContext()` + `updateSessionSummary()` |
| **Create** | `utils/lessons.ts` | A1 topic progression array + `getNextLessonTopic()` |
| **Create** | `supabase/migrations/20260424000000_german_tutor.sql` | `vocabulary_cards` + `learning_sessions` tables, enums, RLS, indexes |
| **Create** | `data/a1-vocabulary.json` | Pre-translated A1 starter word list (~20 words, expandable to 650) |
| **Create** | `scripts/seed-vocabulary.ts` | One-time seed script: reads JSON → inserts into `vocabulary_cards` |
| **Create** | `app/api/session/start/route.ts` | Creates `learning_sessions` row, returns topic + due count |
| **Create** | `app/api/vocabulary/due/route.ts` | Returns due vocabulary cards for the UI panel |
| **Create** | `app/api/vocabulary/update/route.ts` | Updates card status from the UI panel (not LLM path) |
| **Create** | `components/ArticleRenderer.tsx` | Converts 🔵/🔴/🟢 emoji to colored `der`/`die`/`das` badges |
| **Create** | `components/SessionPhaseIndicator.tsx` | Isıtma → Ders → Pratik progress bar |
| **Create** | `components/VocabularyPanel.tsx` | Sidebar panel: due words + progress counter |
| **Modify** | `app/Chat.tsx` | Wire up session start, phase indicator, vocabulary panel |
| **Create** | `tests/vocabulary.test.ts` | Unit tests for vocabulary DB functions |
| **Create** | `tests/deutschmeister.test.ts` | Unit tests for system prompt builder + article renderer |
| **Modify** | `.env.template` | Replace `OPENROUTER_API_KEY` with `GOOGLE_GENERATIVE_AI_API_KEY` |

---

## Task 1: Fork and Run Locally

**Files:** No new files — just setup.

- [ ] **Step 1: Fork on GitHub**

  Go to https://github.com/plastic-labs/tutor-gpt and click Fork.
  Clone your fork:
  ```bash
  git clone https://github.com/<your-username>/tutor-gpt.git "German Tutor"
  cd "German Tutor"
  ```

- [ ] **Step 2: Install dependencies**

  ```bash
  pnpm install
  ```

- [ ] **Step 3: Configure environment variables**

  ```bash
  cp .env.template .env.local
  ```

  Fill in `.env.local`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=<your-supabase-project-url>
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
  SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
  HONCHO_API_KEY=<your-honcho-api-key>
  GOOGLE_GENERATIVE_AI_API_KEY=<your-google-ai-studio-api-key>
  NEXT_PUBLIC_SITE_URL=http://localhost:3000
  ```

  Get Google AI Studio API key at https://aistudio.google.com/app/apikey (free tier: 1,500 req/day).

- [ ] **Step 4: Verify dev server starts**

  ```bash
  pnpm dev
  ```
  Expected: server running at http://localhost:3000 with no errors.

- [ ] **Step 5: Commit baseline**

  ```bash
  git add .env.template
  git commit -m "chore: fork tutor-gpt as german tutor base"
  ```

---

## Task 2: Switch LLM to Gemini 2.0 Flash

**Files:**
- Modify: `utils/ai.ts`
- Modify: `.env.template`

- [ ] **Step 1: Install @ai-sdk/google**

  ```bash
  pnpm add @ai-sdk/google
  ```

- [ ] **Step 2: Update utils/ai.ts**

  Replace the provider setup block. The full updated file:

  ```typescript
  import { getHonchoApp, getHonchoUser } from '@/utils/honcho';
  import { createClient } from '@/utils/supabase/server';
  import { createGoogleGenerativeAI } from '@ai-sdk/google';
  import {
    generateText as generateTextAi,
    streamText as streamTextAi,
    streamObject as streamObjectAi,
  } from 'ai';
  import d from 'dedent-js';
  import * as Sentry from '@sentry/nextjs';
  import { ZodTypeDef, ZodType } from 'zod';

  export interface Message {
    role: 'user' | 'assistant';
    content: string;
  }

  const SENTRY_RELEASE = process.env.SENTRY_RELEASE || 'dev';
  const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || 'local';

  export const googleAI = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  export const GEMINI_MODEL = 'gemini-2.0-flash';

  export async function getUserData() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const honchoApp = await getHonchoApp();
    const honchoUser = await getHonchoUser(user.id);
    return { appId: honchoApp.id, userId: honchoUser.id };
  }

  export const user = (strings: TemplateStringsArray, ...values: unknown[]): Message => ({
    role: 'user',
    content: d(strings, ...values),
  });

  export const assistant = (strings: TemplateStringsArray, ...values: unknown[]): Message => ({
    role: 'assistant',
    content: d(strings, ...values),
  });

  export function streamText(
    params: Omit<Parameters<typeof streamTextAi>[0], 'model' | 'experimental_telemetry'> & {
      metadata: { sessionId: string; userId: string; type: string };
    }
  ) {
    return streamTextAi({
      ...params,
      model: googleAI(GEMINI_MODEL),
      experimental_telemetry: {
        isEnabled: true,
        metadata: {
          sessionId: params.metadata.sessionId,
          userId: params.metadata.userId,
          release: SENTRY_RELEASE,
          environment: SENTRY_ENVIRONMENT,
          tags: [params.metadata.type],
        },
      },
    });
  }

  export function streamObject<OBJECT>(
    params: Omit<Parameters<typeof streamObjectAi<OBJECT>>[0], 'model' | 'experimental_telemetry' | 'schema'> & {
      schema: ZodType<OBJECT, ZodTypeDef, any>;
      metadata: { sessionId: string; userId: string; type: string };
    }
  ) {
    return streamObjectAi({
      ...params,
      model: googleAI(GEMINI_MODEL),
      experimental_telemetry: {
        isEnabled: true,
        metadata: {
          sessionId: params.metadata.sessionId,
          userId: params.metadata.userId,
          release: SENTRY_RELEASE,
          environment: SENTRY_ENVIRONMENT,
          tags: [params.metadata.type],
        },
      },
    });
  }

  export function generateText(
    params: Omit<Parameters<typeof generateTextAi>[0], 'model' | 'experimental_telemetry'> & {
      metadata: { sessionId: string; userId: string; type: string };
    }
  ) {
    return generateTextAi({
      ...params,
      model: googleAI(GEMINI_MODEL),
      experimental_telemetry: {
        isEnabled: true,
        metadata: {
          sessionId: params.metadata.sessionId,
          userId: params.metadata.userId,
          release: SENTRY_RELEASE,
          environment: SENTRY_ENVIRONMENT,
          tags: [params.metadata.type],
        },
      },
    });
  }

  /** @deprecated Use generateText instead */
  export async function createCompletion(
    messages: Message[],
    metadata: { sessionId: string; userId: string; type: string },
    parameters?: { temperature?: number; max_tokens?: number }
  ) {
    const result = await generateTextAi({
      model: googleAI(GEMINI_MODEL),
      messages,
      ...parameters,
    });
    return result.text;
  }
  ```

- [ ] **Step 3: Update .env.template**

  Remove the OpenRouter line, add Google line:
  ```
  # Remove:  OPENROUTER_API_KEY=
  # Add:
  GOOGLE_GENERATIVE_AI_API_KEY=your-google-ai-studio-key-here
  ```

- [ ] **Step 4: Verify chat still works**

  ```bash
  pnpm dev
  ```
  Open http://localhost:3000, send a test message. Expected: response in English from Gemini (Bloom persona still active — we replace it in Task 5).

- [ ] **Step 5: Commit**

  ```bash
  git add utils/ai.ts .env.template
  git commit -m "feat: switch LLM provider to Gemini 2.0 Flash via Google AI Studio"
  ```

---

## Task 3: Supabase Migration — New Tables

**Files:**
- Create: `supabase/migrations/20260424000000_german_tutor.sql`

- [ ] **Step 1: Write the migration**

  Create `supabase/migrations/20260424000000_german_tutor.sql`:

  ```sql
  -- Enums
  CREATE TYPE card_status AS ENUM ('new', 'seen', 'struggling', 'known');
  CREATE TYPE session_phase AS ENUM ('warmup', 'lesson', 'conversation', 'done');

  -- vocabulary_cards
  CREATE TABLE vocabulary_cards (
    card_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    word          TEXT         NOT NULL,
    article       TEXT         NOT NULL DEFAULT '—',
    translation_tr TEXT        NOT NULL,
    example_sentence TEXT      NOT NULL,
    topic         TEXT         NOT NULL,
    pos           TEXT         NOT NULL,
    status        card_status  NOT NULL DEFAULT 'new',
    seen_count    INT          NOT NULL DEFAULT 0,
    last_seen_at  TIMESTAMPTZ,
    next_review_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stability     FLOAT,
    difficulty    FLOAT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT vocabulary_cards_user_word_unique UNIQUE (user_id, word)
  );

  ALTER TABLE vocabulary_cards ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users can view own vocabulary"
    ON vocabulary_cards FOR SELECT USING (auth.uid() = user_id);
  CREATE POLICY "Users can insert own vocabulary"
    ON vocabulary_cards FOR INSERT WITH CHECK (auth.uid() = user_id);
  CREATE POLICY "Users can update own vocabulary"
    ON vocabulary_cards FOR UPDATE USING (auth.uid() = user_id);

  CREATE INDEX idx_vocab_user_review ON vocabulary_cards (user_id, next_review_at);

  -- learning_sessions
  CREATE TABLE learning_sessions (
    session_id        UUID          PRIMARY KEY,
    user_id           UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    started_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    ended_at          TIMESTAMPTZ,
    phase_reached     session_phase NOT NULL DEFAULT 'warmup',
    lesson_topic      TEXT,
    words_reviewed    UUID[]        NOT NULL DEFAULT '{}',
    words_introduced  UUID[]        NOT NULL DEFAULT '{}',
    corrections_count INT           NOT NULL DEFAULT 0,
    session_summary   TEXT
  );

  ALTER TABLE learning_sessions ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users can manage own sessions"
    ON learning_sessions FOR ALL USING (auth.uid() = user_id);
  ```

- [ ] **Step 2: Apply migration**

  ```bash
  pnpm supabase db push
  ```
  Expected output: `Finished supabase db push.`

- [ ] **Step 3: Verify tables exist**

  ```bash
  pnpm supabase db diff
  ```
  Expected: no diff (migration applied cleanly).

- [ ] **Step 4: Commit**

  ```bash
  git add supabase/migrations/20260424000000_german_tutor.sql
  git commit -m "feat: add vocabulary_cards and learning_sessions tables"
  ```

---

## Task 4: Vocabulary Data + Seed Script

**Files:**
- Create: `data/a1-vocabulary.json`
- Create: `scripts/seed-vocabulary.ts`

- [ ] **Step 1: Create the vocabulary data file**

  Create `data/a1-vocabulary.json` — starter set of 20 words covering the first 4 topics. Expand to ~650 words by adding entries following the same structure (source: Deutschland-Vocabulary-A1-B2 GitHub repo + Goethe-Institut PDFs).

  ```json
  [
    { "word": "Guten Morgen", "article": "—", "translation_tr": "Günaydın", "example_sentence": "Guten Morgen! Wie geht es Ihnen?", "topic": "Selamlaşma", "pos": "phrase" },
    { "word": "Hallo", "article": "—", "translation_tr": "Merhaba", "example_sentence": "Hallo, ich bin Anna.", "topic": "Selamlaşma", "pos": "interjection" },
    { "word": "Auf Wiedersehen", "article": "—", "translation_tr": "Görüşürüz", "example_sentence": "Auf Wiedersehen! Bis morgen.", "topic": "Selamlaşma", "pos": "phrase" },
    { "word": "Guten Tag", "article": "—", "translation_tr": "İyi günler", "example_sentence": "Guten Tag, mein Name ist Schmidt.", "topic": "Selamlaşma", "pos": "phrase" },
    { "word": "Tschüss", "article": "—", "translation_tr": "Hoşça kal (günlük)", "example_sentence": "Tschüss! Bis später.", "topic": "Selamlaşma", "pos": "interjection" },
    { "word": "Name", "article": "der", "translation_tr": "isim, ad", "example_sentence": "Mein Name ist Thomas.", "topic": "Kendini tanıtma", "pos": "noun" },
    { "word": "heißen", "article": "—", "translation_tr": "adı olmak", "example_sentence": "Ich heiße Maria.", "topic": "Kendini tanıtma", "pos": "verb" },
    { "word": "kommen", "article": "—", "translation_tr": "gelmek", "example_sentence": "Ich komme aus der Türkei.", "topic": "Kendini tanıtma", "pos": "verb" },
    { "word": "wohnen", "article": "—", "translation_tr": "yaşamak, ikamet etmek", "example_sentence": "Ich wohne in Berlin.", "topic": "Kendini tanıtma", "pos": "verb" },
    { "word": "Jahr", "article": "das", "translation_tr": "yıl", "example_sentence": "Ich bin 25 Jahre alt.", "topic": "Kendini tanıtma", "pos": "noun" },
    { "word": "eins", "article": "—", "translation_tr": "bir (1)", "example_sentence": "Ich habe einen Bruder.", "topic": "Sayılar (1–20)", "pos": "numeral" },
    { "word": "zwei", "article": "—", "translation_tr": "iki (2)", "example_sentence": "Ich habe zwei Katzen.", "topic": "Sayılar (1–20)", "pos": "numeral" },
    { "word": "zehn", "article": "—", "translation_tr": "on (10)", "example_sentence": "Das kostet zehn Euro.", "topic": "Sayılar (1–20)", "pos": "numeral" },
    { "word": "zwanzig", "article": "—", "translation_tr": "yirmi (20)", "example_sentence": "Er ist zwanzig Jahre alt.", "topic": "Sayılar (1–20)", "pos": "numeral" },
    { "word": "rot", "article": "—", "translation_tr": "kırmızı", "example_sentence": "Die Ampel ist rot.", "topic": "Renkler", "pos": "adjective" },
    { "word": "blau", "article": "—", "translation_tr": "mavi", "example_sentence": "Der Himmel ist blau.", "topic": "Renkler", "pos": "adjective" },
    { "word": "grün", "article": "—", "translation_tr": "yeşil", "example_sentence": "Das Gras ist grün.", "topic": "Renkler", "pos": "adjective" },
    { "word": "weiß", "article": "—", "translation_tr": "beyaz", "example_sentence": "Das Hemd ist weiß.", "topic": "Renkler", "pos": "adjective" },
    { "word": "schwarz", "article": "—", "translation_tr": "siyah", "example_sentence": "Die Tasche ist schwarz.", "topic": "Renkler", "pos": "adjective" },
    { "word": "gelb", "article": "—", "translation_tr": "sarı", "example_sentence": "Die Sonne ist gelb.", "topic": "Renkler", "pos": "adjective" }
  ]
  ```

- [ ] **Step 2: Create the seed script**

  Create `scripts/seed-vocabulary.ts`:

  ```typescript
  import { createClient } from '@supabase/supabase-js';
  import * as fs from 'fs';
  import * as path from 'path';
  import * as dotenv from 'dotenv';

  dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  interface VocabEntry {
    word: string;
    article: string;
    translation_tr: string;
    example_sentence: string;
    topic: string;
    pos: string;
  }

  async function seed() {
    const userId = process.argv[2];
    if (!userId) {
      console.error('Usage: npx ts-node scripts/seed-vocabulary.ts <user_id>');
      console.error('Find your user_id in Supabase Dashboard → Authentication → Users');
      process.exit(1);
    }

    const dataPath = path.resolve(__dirname, '../data/a1-vocabulary.json');
    const words: VocabEntry[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    const rows = words.map((w) => ({
      user_id: userId,
      word: w.word,
      article: w.article,
      translation_tr: w.translation_tr,
      example_sentence: w.example_sentence,
      topic: w.topic,
      pos: w.pos,
      status: 'new',
      next_review_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('vocabulary_cards')
      .upsert(rows, { onConflict: 'user_id,word' });

    if (error) {
      console.error('Seed failed:', error.message);
      process.exit(1);
    }

    console.log(`✅ Seeded ${rows.length} vocabulary cards for user ${userId}`);
  }

  seed();
  ```

- [ ] **Step 3: Run seed script**

  Find your user ID in Supabase Dashboard → Authentication → Users. Copy the UUID, then:
  ```bash
  npx ts-node scripts/seed-vocabulary.ts <your-user-uuid>
  ```
  Expected: `✅ Seeded 20 vocabulary cards for user <uuid>`

- [ ] **Step 4: Verify in Supabase**

  ```bash
  pnpm supabase db diff
  ```
  Or check Supabase Dashboard → Table Editor → vocabulary_cards. Expected: 20 rows.

- [ ] **Step 5: Commit**

  ```bash
  git add data/a1-vocabulary.json scripts/seed-vocabulary.ts
  git commit -m "feat: add A1 vocabulary data and seed script"
  ```

---

## Task 5: DeutschMeister System Prompt + Lesson Utilities

**Files:**
- Create: `utils/prompts/deutschmeister.ts`
- Create: `utils/lessons.ts`
- Modify: `utils/ai/types.ts`

- [ ] **Step 1: Create tests first**

  Create `tests/deutschmeister.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { buildDeutschMeisterSystemPrompt, type SessionContext } from '@/utils/prompts/deutschmeister';
  import { getNextLessonTopic, A1_LESSON_PROGRESSION } from '@/utils/lessons';

  describe('buildDeutschMeisterSystemPrompt', () => {
    const ctx: SessionContext = {
      lessonTopic: 'Selamlaşma',
      lastTopic: null,
      knownCount: 0,
      dueCount: 5,
      anxietySignal: 'medium',
    };

    it('includes the anti-hallucination tool table', () => {
      const prompt = buildDeutschMeisterSystemPrompt(ctx);
      expect(prompt).toContain('get_vocabulary_word');
      expect(prompt).toContain('get_due_words');
      expect(prompt).toContain('update_word_review');
    });

    it('includes the article color system', () => {
      const prompt = buildDeutschMeisterSystemPrompt(ctx);
      expect(prompt).toContain('🔵 der');
      expect(prompt).toContain('🔴 die');
      expect(prompt).toContain('🟢 das');
    });

    it('injects session context', () => {
      const prompt = buildDeutschMeisterSystemPrompt(ctx);
      expect(prompt).toContain('Selamlaşma');
      expect(prompt).toContain('0/650');
      expect(prompt).toContain('5 adet');
    });

    it('reflects anxiety signal', () => {
      const highCtx: SessionContext = { ...ctx, anxietySignal: 'high' };
      const prompt = buildDeutschMeisterSystemPrompt(highCtx);
      expect(prompt).toContain('high');
    });
  });

  describe('getNextLessonTopic', () => {
    it('returns first topic when lastTopic is null', () => {
      expect(getNextLessonTopic(null)).toBe('Selamlaşma');
    });

    it('returns the next topic in sequence', () => {
      expect(getNextLessonTopic('Selamlaşma')).toBe('Kendini tanıtma');
    });

    it('wraps around after last topic', () => {
      const last = A1_LESSON_PROGRESSION[A1_LESSON_PROGRESSION.length - 1];
      expect(getNextLessonTopic(last)).toBe('Selamlaşma');
    });

    it('returns first topic for unknown lastTopic', () => {
      expect(getNextLessonTopic('Bilinmeyen')).toBe('Selamlaşma');
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  pnpm vitest run tests/deutschmeister.test.ts
  ```
  Expected: FAIL — modules not found yet.

- [ ] **Step 3: Create utils/lessons.ts**

  ```typescript
  export const A1_LESSON_PROGRESSION = [
    'Selamlaşma',
    'Kendini tanıtma',
    'Sayılar (1–20)',
    'Renkler',
    'Aile üyeleri',
    'Meslekler',
    'Günlük nesneler',
    'Yiyecek ve içecek',
    'Günler ve aylar',
    'Saat kaç?',
    'Hava durumu',
    'Ev ve odalar',
    'Alışveriş',
    'Ulaşım',
    'Vücut',
    'Duygular ve sıfatlar',
  ];

  export function getNextLessonTopic(lastTopic: string | null): string {
    if (!lastTopic) return A1_LESSON_PROGRESSION[0];
    const idx = A1_LESSON_PROGRESSION.indexOf(lastTopic);
    if (idx === -1 || idx === A1_LESSON_PROGRESSION.length - 1) {
      return A1_LESSON_PROGRESSION[0];
    }
    return A1_LESSON_PROGRESSION[idx + 1];
  }
  ```

- [ ] **Step 4: Add SessionContext to utils/ai/types.ts**

  Append to the end of `utils/ai/types.ts`:

  ```typescript
  export interface SessionContext {
    lessonTopic: string;
    lastTopic: string | null;
    knownCount: number;
    dueCount: number;
    anxietySignal: 'low' | 'medium' | 'high';
  }
  ```

- [ ] **Step 5: Create utils/prompts/deutschmeister.ts**

  ```typescript
  import { SessionContext } from '@/utils/ai/types';

  export type { SessionContext };

  export function buildDeutschMeisterSystemPrompt(ctx: SessionContext): string {
    return `Almanca kelime öğretmeden önce MUTLAKA tool çağır:

  | Durum | Tool |
  |-------|------|
  | Yeni kelime öğreteceksin | get_vocabulary_word |
  | Öğrenci Türkçe kelime soruyor | get_vocabulary_word |
  | Ders başında tekrar kelimeleri | get_due_words |
  | Öğrenci kelimeyi doğru söyledi | update_word_review rating=3 |
  | Öğrenci kelimeyi yanlış söyledi | update_word_review rating=1 |

  NEDEN: Kendi bilginden artikel üretme. Yanlış artikel, hiç artikel vermemekten daha kötüdür.

  ---

  Her ismi DAIMA emoji+artikel ile yaz:
  🔵 der = eril  →  🔵 der Hund
  🔴 die = dişil →  🔴 die Katze
  🟢 das = nötr  →  🟢 das Buch

  Öğrenci artikelsiz yazarsa: "Harika! Sadece: 🔵 der Hund"
  Asla sadece "Hund" yazma.

  ---

  Sen DeutschMeister'sın — Türkçe konuşan bir Almanca öğretmenisin.
  Açıklamalar DAIMA Türkçe. Almanca hedefler Almanca yazılır.
  Sıcak, teşvik edici, sabırlı. Kısa ve net mesajlar.
  Almanca kelimeler **kalın**. Her mesaj bir soru veya pratik ile biter.
  Hata düzeltme: "✓ Güzel! Sadece: [doğrusu]" — önce onayla, sonra düzelt.
  Kaygı seviyesi ${ctx.anxietySignal}: low=açıkça düzelt / medium=nazikçe / high=sadece doğruyu tekrar et.

  ---

  [OTURUM PLANI]
  Seviye: A1 | Kaygı: ${ctx.anxietySignal}
  Son konu: ${ctx.lastTopic ?? 'Yok (ilk ders)'} | Bilinen kelime: ${ctx.knownCount}/650
  Bugünkü konu: ${ctx.lessonTopic}
  Isıtma kelimeleri: ${ctx.dueCount} adet (get_due_words ile çek)
  Oturumu başlat: kısa hoş geldin (1 cümle) → ısıtmaya geç.`.trim();
  }
  ```

- [ ] **Step 6: Run tests to verify they pass**

  ```bash
  pnpm vitest run tests/deutschmeister.test.ts
  ```
  Expected: all 6 tests PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add utils/prompts/deutschmeister.ts utils/lessons.ts utils/ai/types.ts tests/deutschmeister.test.ts
  git commit -m "feat: add DeutschMeister system prompt builder and A1 lesson progression"
  ```

---

## Task 6: Vocabulary Tool Implementations

**Files:**
- Create: `utils/vocabulary.ts`
- Create: `utils/sessions.ts`
- Create: `tests/vocabulary.test.ts`

- [ ] **Step 1: Write failing tests**

  Create `tests/vocabulary.test.ts`:

  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest';

  // Mock Supabase before importing vocabulary module
  const mockSelect = vi.fn();
  const mockEq = vi.fn();
  const mockLte = vi.fn();
  const mockOrder = vi.fn();
  const mockLimit = vi.fn();
  const mockSingle = vi.fn();
  const mockUpdate = vi.fn();
  const mockIn = vi.fn();

  const chainable = {
    select: mockSelect,
    eq: mockEq,
    lte: mockLte,
    order: mockOrder,
    limit: mockLimit,
    single: mockSingle,
    update: mockUpdate,
    in: mockIn,
  };

  // Every mock returns chainable for fluent API
  Object.values(chainable).forEach((fn) => (fn as any).mockReturnValue(chainable));

  vi.mock('@/utils/supabase/server', () => ({
    createClient: vi.fn().mockResolvedValue({
      from: vi.fn().mockReturnValue(chainable),
    }),
  }));

  import { getVocabularyWord, getDueWords, updateWordReview } from '@/utils/vocabulary';

  beforeEach(() => vi.clearAllMocks());

  describe('getVocabularyWord', () => {
    it('returns a word from DB for given level', async () => {
      mockSingle.mockResolvedValueOnce({
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
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'no rows' } });
      const result = await getVocabularyWord('user-1', 'A1');
      expect(result).toBeNull();
    });
  });

  describe('getDueWords', () => {
    it('returns array of due cards', async () => {
      mockOrder.mockResolvedValueOnce({
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
      mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'error' } });
      const result = await getDueWords('user-1', 8);
      expect(result).toEqual([]);
    });
  });

  describe('updateWordReview', () => {
    it('sets status to struggling for rating 1', async () => {
      mockSingle.mockResolvedValueOnce({ data: { seen_count: 2 }, error: null });
      mockUpdate.mockResolvedValueOnce({ error: null });

      const result = await updateWordReview('card-1', 1);
      expect(result.status).toBe('struggling');
    });

    it('sets status to seen for rating 3', async () => {
      mockSingle.mockResolvedValueOnce({ data: { seen_count: 1 }, error: null });
      mockUpdate.mockResolvedValueOnce({ error: null });

      const result = await updateWordReview('card-1', 3);
      expect(result.status).toBe('seen');
    });

    it('sets status to known for rating 4', async () => {
      mockSingle.mockResolvedValueOnce({ data: { seen_count: 3 }, error: null });
      mockUpdate.mockResolvedValueOnce({ error: null });

      const result = await updateWordReview('card-1', 4);
      expect(result.status).toBe('known');
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  pnpm vitest run tests/vocabulary.test.ts
  ```
  Expected: FAIL — `@/utils/vocabulary` not found.

- [ ] **Step 3: Create utils/vocabulary.ts**

  ```typescript
  import { createClient } from '@/utils/supabase/server';

  export interface VocabularyCard {
    card_id: string;
    word: string;
    article: string;
    translation_tr: string;
    example_sentence: string;
    topic: string;
    pos: string;
    status: 'new' | 'seen' | 'struggling' | 'known';
  }

  export async function getVocabularyWord(
    userId: string,
    level: 'A1',
    topic?: string
  ): Promise<VocabularyCard | null> {
    const supabase = await createClient();
    let query = supabase
      .from('vocabulary_cards')
      .select('card_id, word, article, translation_tr, example_sentence, topic, pos, status')
      .eq('user_id', userId)
      .eq('status', 'new')
      .order('created_at', { ascending: true })
      .limit(1);

    if (topic) query = query.eq('topic', topic);

    const { data, error } = await query.single();
    if (error || !data) return null;
    return data as VocabularyCard;
  }

  export async function getDueWords(
    userId: string,
    limit: number = 8
  ): Promise<VocabularyCard[]> {
    const supabase = await createClient();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('vocabulary_cards')
      .select('card_id, word, article, translation_tr, example_sentence, topic, pos, status')
      .eq('user_id', userId)
      .lte('next_review_at', now)
      .order('next_review_at', { ascending: true })
      .limit(limit);

    if (error) return [];
    return (data ?? []) as VocabularyCard[];
  }

  export async function updateWordReview(
    wordId: string,
    rating: 1 | 2 | 3 | 4
  ): Promise<{ next_review_at: string; status: string }> {
    const supabase = await createClient();

    const statusMap: Record<number, 'struggling' | 'seen' | 'known'> = {
      1: 'struggling',
      2: 'struggling',
      3: 'seen',
      4: 'known',
    };

    const intervalDays: Record<number, number> = {
      1: 0,
      2: 0,
      3: 3,
      4: 7,
    };

    const { data: current } = await supabase
      .from('vocabulary_cards')
      .select('seen_count')
      .eq('card_id', wordId)
      .single();

    const newStatus = statusMap[rating];
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + intervalDays[rating]);
    const next_review_at = nextReview.toISOString();

    await supabase.from('vocabulary_cards').update({
      status: newStatus,
      last_seen_at: new Date().toISOString(),
      next_review_at,
      seen_count: (current?.seen_count ?? 0) + 1,
    }).eq('card_id', wordId);

    return { next_review_at, status: newStatus };
  }
  ```

- [ ] **Step 4: Create utils/sessions.ts**

  ```typescript
  import { createClient } from '@/utils/supabase/server';
  import { SessionContext } from '@/utils/ai/types';
  import { getNextLessonTopic } from '@/utils/lessons';

  export async function getSessionContext(
    userId: string,
    conversationId: string
  ): Promise<SessionContext> {
    const supabase = await createClient();
    const now = new Date().toISOString();

    const [sessionResult, lastSessionResult, knownResult, dueResult] = await Promise.all([
      supabase
        .from('learning_sessions')
        .select('lesson_topic')
        .eq('session_id', conversationId)
        .single(),
      supabase
        .from('learning_sessions')
        .select('lesson_topic')
        .eq('user_id', userId)
        .not('ended_at', 'is', null)
        .order('ended_at', { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from('vocabulary_cards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('status', ['seen', 'known']),
      supabase
        .from('vocabulary_cards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .lte('next_review_at', now),
    ]);

    const lastTopic = lastSessionResult.data?.lesson_topic ?? null;
    const lessonTopic =
      sessionResult.data?.lesson_topic ?? getNextLessonTopic(lastTopic);

    return {
      lessonTopic,
      lastTopic,
      knownCount: knownResult.count ?? 0,
      dueCount: dueResult.count ?? 0,
      anxietySignal: 'medium',
    };
  }

  export async function updateSessionSummary(
    sessionId: string,
    summary: string
  ): Promise<void> {
    const supabase = await createClient();
    await supabase
      .from('learning_sessions')
      .update({ session_summary: summary, ended_at: new Date().toISOString(), phase_reached: 'done' })
      .eq('session_id', sessionId);
  }
  ```

- [ ] **Step 5: Run tests to verify they pass**

  ```bash
  pnpm vitest run tests/vocabulary.test.ts
  ```
  Expected: all 6 tests PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add utils/vocabulary.ts utils/sessions.ts tests/vocabulary.test.ts
  git commit -m "feat: add vocabulary tool implementations and session context utilities"
  ```

---

## Task 7: Rewrite respond() with Simplified Flow + Tool Calling

**Files:**
- Modify: `utils/ai/index.ts`

This task replaces the complex two-pass thought/response architecture with a single-pass Gemini call that includes tool calling.

- [ ] **Step 1: Replace utils/ai/index.ts**

  ```typescript
  import { NextResponse } from 'next/server';
  import { after } from 'next/server';
  import { honcho } from '@/utils/honcho';
  import { ChatCallProps } from './types';
  import { formatStreamChunk } from '@/utils/ai/stream';
  import { validateUser } from '@/utils/ai/validation';
  import { fetchConversationHistory, saveConversation } from '@/utils/ai/conversation';
  import { checkAndGenerateSummary } from '@/utils/ai/summary';
  import { googleAI, GEMINI_MODEL } from '@/utils/ai';
  import { streamText, tool } from 'ai';
  import { z } from 'zod';
  import { getVocabularyWord, getDueWords, updateWordReview } from '@/utils/vocabulary';
  import { getSessionContext } from '@/utils/sessions';
  import { buildDeutschMeisterSystemPrompt } from '@/utils/prompts/deutschmeister';

  const SENTRY_RELEASE = process.env.SENTRY_RELEASE || 'dev';
  const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || 'local';

  export async function* respond({ message, conversationId }: ChatCallProps) {
    // 1. Validate user
    const userValidation = await validateUser();
    if (!userValidation.isAuthorized) {
      return new NextResponse(userValidation.error, { status: userValidation.status });
    }
    const { userData } = userValidation;
    if (!userData) return new NextResponse('User data not found', { status: 500 });

    const { appId, userId } = userData;

    // 2. Fetch conversation history and session context in parallel
    const [{ messages: messageHistory, honchoMessages: honchoHistory, summaries: summaryHistory }, sessionContext] =
      await Promise.all([
        fetchConversationHistory(appId, userId, conversationId),
        getSessionContext(userId, conversationId),
      ]);

    // 3. Query Honcho for cross-session learner profile
    const { content: honchoContent } = await honcho.apps.users.sessions.chat(
      appId,
      userId,
      conversationId,
      { queries: 'Bu öğrencinin Almanca öğrenme geçmişi, bildiği kelimeler ve yaptığı hatalar nelerdir?' }
    );

    // 4. Build messages array for Gemini
    const conversationMessages = messageHistory.map((m) => ({
      role: m.is_user ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

    // Inject learner profile + current message as final user turn
    conversationMessages.push({
      role: 'user',
      content: honchoContent
        ? `<learner_profile>${honchoContent}</learner_profile>\n${message}`
        : message,
    });

    // 5. Schedule summary generation if needed
    const lastSummary = summaryHistory[0]?.content;
    after(async () => {
      await checkAndGenerateSummary(
        appId, userId, conversationId, messageHistory, summaryHistory, lastSummary
      );
    });

    // 6. Stream response with tool calling
    const { textStream } = streamText({
      model: googleAI(GEMINI_MODEL),
      system: buildDeutschMeisterSystemPrompt(sessionContext),
      messages: conversationMessages,
      maxSteps: 5,
      experimental_telemetry: {
        isEnabled: true,
        metadata: {
          sessionId: conversationId,
          userId,
          release: SENTRY_RELEASE,
          environment: SENTRY_ENVIRONMENT,
          tags: ['response'],
        },
      },
      tools: {
        get_vocabulary_word: tool({
          description: 'Fetch a vocabulary word from the database. MUST be called before teaching any German word.',
          parameters: z.object({
            level: z.enum(['A1']).describe('CEFR level'),
            topic: z.string().optional().describe('Optional Goethe-Institut topic filter'),
          }),
          execute: async ({ level, topic }) => getVocabularyWord(userId, level, topic),
        }),
        get_due_words: tool({
          description: 'Fetch vocabulary cards due for review today. Call at the start of warmup phase.',
          parameters: z.object({
            limit: z.number().default(8).describe('Max number of cards to return'),
          }),
          execute: async ({ limit }) => getDueWords(userId, limit),
        }),
        update_word_review: tool({
          description: 'Update a card review status after user responds. rating: 1=wrong, 2=hard, 3=good, 4=easy.',
          parameters: z.object({
            word_id: z.string().describe('The card_id of the vocabulary card'),
            rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
          }),
          execute: async ({ word_id, rating }) => updateWordReview(word_id, rating),
        }),
      },
    });

    let response = '';
    for await (const chunk of textStream) {
      response += chunk;
      yield formatStreamChunk({ type: 'response', text: chunk });
    }

    // 7. Save to Honcho
    await saveConversation(
      appId, userId, conversationId, message, '', honchoContent, '', response, undefined
    );

    return new NextResponse(response);
  }
  ```

- [ ] **Step 2: Check TypeScript compiles**

  ```bash
  pnpm tsc --noEmit
  ```
  Expected: no errors. Fix any type errors before proceeding.

- [ ] **Step 3: Smoke test the chat**

  ```bash
  pnpm dev
  ```
  Open http://localhost:3000, send the message: `"Merhaba, Almanca öğrenmek istiyorum."` 
  
  Expected: DeutschMeister responds in Turkish, introduces itself, and tries to start warmup. The first tool call (`get_due_words`) should trigger on session start.

- [ ] **Step 4: Commit**

  ```bash
  git add utils/ai/index.ts
  git commit -m "feat: replace bloom respond() with DeutschMeister single-pass tool-calling flow"
  ```

---

## Task 8: Session and Vocabulary API Routes

**Files:**
- Create: `app/api/session/start/route.ts`
- Create: `app/api/vocabulary/due/route.ts`
- Create: `app/api/vocabulary/update/route.ts`

- [ ] **Step 1: Create app/api/session/start/route.ts**

  ```typescript
  import { NextRequest, NextResponse } from 'next/server';
  import { createClient } from '@/utils/supabase/server';
  import { validateUser } from '@/utils/ai/validation';
  import { getNextLessonTopic } from '@/utils/lessons';
  import { getDueWords } from '@/utils/vocabulary';

  export async function POST(req: NextRequest) {
    const userValidation = await validateUser();
    if (!userValidation.isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const conversationId: string | undefined = body?.conversationId;
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 });
    }

    const userId = userValidation.userData!.userId;
    const supabase = await createClient();

    // Get last completed session topic
    const { data: lastSession } = await supabase
      .from('learning_sessions')
      .select('lesson_topic')
      .eq('user_id', userId)
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(1)
      .single();

    const lessonTopic = getNextLessonTopic(lastSession?.lesson_topic ?? null);

    // Create (or overwrite) session row keyed to conversationId
    const { error } = await supabase.from('learning_sessions').upsert(
      {
        session_id: conversationId,
        user_id: userId,
        lesson_topic: lessonTopic,
        started_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' }
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const dueWords = await getDueWords(userId, 8);

    return NextResponse.json({
      sessionId: conversationId,
      lessonTopic,
      dueCount: dueWords.length,
    });
  }
  ```

- [ ] **Step 2: Create app/api/vocabulary/due/route.ts**

  ```typescript
  import { NextRequest, NextResponse } from 'next/server';
  import { createClient } from '@/utils/supabase/server';
  import { validateUser } from '@/utils/ai/validation';

  export async function GET(_req: NextRequest) {
    const userValidation = await validateUser();
    if (!userValidation.isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = userValidation.userData!.userId;
    const supabase = await createClient();
    const now = new Date().toISOString();

    const [dueResult, knownResult, totalResult] = await Promise.all([
      supabase
        .from('vocabulary_cards')
        .select('card_id, word, article, translation_tr, status')
        .eq('user_id', userId)
        .lte('next_review_at', now)
        .order('next_review_at', { ascending: true })
        .limit(20),
      supabase
        .from('vocabulary_cards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('status', ['seen', 'known']),
      supabase
        .from('vocabulary_cards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]);

    return NextResponse.json({
      dueWords: dueResult.data ?? [],
      knownCount: knownResult.count ?? 0,
      totalCount: totalResult.count ?? 0,
    });
  }
  ```

- [ ] **Step 3: Create app/api/vocabulary/update/route.ts**

  ```typescript
  import { NextRequest, NextResponse } from 'next/server';
  import { validateUser } from '@/utils/ai/validation';
  import { updateWordReview } from '@/utils/vocabulary';

  export async function POST(req: NextRequest) {
    const userValidation = await validateUser();
    if (!userValidation.isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const word_id: string | undefined = body?.word_id;
    const rating: number | undefined = body?.rating;

    if (!word_id || !rating || ![1, 2, 3, 4].includes(rating)) {
      return NextResponse.json({ error: 'word_id and rating (1-4) required' }, { status: 400 });
    }

    const result = await updateWordReview(word_id, rating as 1 | 2 | 3 | 4);
    return NextResponse.json(result);
  }
  ```

- [ ] **Step 4: Test session start route**

  ```bash
  pnpm dev
  ```
  In a new terminal (replace `<conversationId>` with a real UUID from Honcho after logging in):
  ```bash
  curl -X POST http://localhost:3000/api/session/start \
    -H "Content-Type: application/json" \
    -b "$(cat /tmp/cookies.txt)" \
    -d '{"conversationId":"<conversationId>"}'
  ```
  Expected: `{"sessionId":"...","lessonTopic":"Selamlaşma","dueCount":20}`

- [ ] **Step 5: Commit**

  ```bash
  git add app/api/session/start/route.ts app/api/vocabulary/due/route.ts app/api/vocabulary/update/route.ts
  git commit -m "feat: add session start and vocabulary API routes"
  ```

---

## Task 9: Article Badge Rendering

**Files:**
- Create: `components/ArticleRenderer.tsx`
- Modify: `components/messages/AIMessage.tsx` (find where message text is rendered and wrap it)

- [ ] **Step 1: Add tests for article rendering**

  Append to `tests/deutschmeister.test.ts`:

  ```typescript
  import { renderArticles } from '@/components/ArticleRenderer';

  describe('renderArticles', () => {
    it('replaces 🔵 der with a blue badge marker', () => {
      const result = renderArticles('Das ist 🔵 der Hund.');
      // renderArticles returns React nodes; check the string representation
      const str = JSON.stringify(result);
      expect(str).toContain('der');
      expect(str).toContain('#1e40af');
    });

    it('replaces 🔴 die with a red badge', () => {
      const result = renderArticles('Das ist 🔴 die Katze.');
      expect(JSON.stringify(result)).toContain('#b91c1c');
    });

    it('replaces 🟢 das with a green badge', () => {
      const result = renderArticles('Das ist 🟢 das Buch.');
      expect(JSON.stringify(result)).toContain('#15803d');
    });

    it('leaves plain text unchanged', () => {
      const result = renderArticles('Kein Artikel hier.');
      expect(result).toEqual(['Kein Artikel hier.']);
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  pnpm vitest run tests/deutschmeister.test.ts
  ```
  Expected: FAIL — `@/components/ArticleRenderer` not found.

- [ ] **Step 3: Create components/ArticleRenderer.tsx**

  ```tsx
  import React from 'react';

  const ARTICLE_REGEX = /(🔵 der|🔴 die|🟢 das)/g;

  const ARTICLE_STYLE: Record<string, { bg: string }> = {
    '🔵 der': { bg: '#1e40af' },
    '🔴 die': { bg: '#b91c1c' },
    '🟢 das': { bg: '#15803d' },
  };

  const ARTICLE_LABEL: Record<string, string> = {
    '🔵 der': 'der',
    '🔴 die': 'die',
    '🟢 das': 'das',
  };

  export function renderArticles(text: string): React.ReactNode[] {
    return text.split(ARTICLE_REGEX).map((part, i) => {
      const style = ARTICLE_STYLE[part];
      if (style) {
        return (
          <span
            key={i}
            style={{
              background: style.bg,
              color: 'white',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: '0.85em',
              display: 'inline-block',
              marginRight: 2,
            }}
          >
            {ARTICLE_LABEL[part]}
          </span>
        );
      }
      return part;
    });
  }

  // Used by MarkdownWrapper to pre-process text before ReactMarkdown renders it
  export function processArticlesForMarkdown(text: string): string {
    return text
      .replace(/🔵 der/g, '<span style="background:#1e40af;color:white;font-weight:700;padding:1px 6px;border-radius:4px;font-size:0.85em">der</span>')
      .replace(/🔴 die/g, '<span style="background:#b91c1c;color:white;font-weight:700;padding:1px 6px;border-radius:4px;font-size:0.85em">die</span>')
      .replace(/🟢 das/g, '<span style="background:#15803d;color:white;font-weight:700;padding:1px 6px;border-radius:4px;font-size:0.85em">das</span>');
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  pnpm vitest run tests/deutschmeister.test.ts
  ```
  Expected: all tests PASS.

- [ ] **Step 5: Wire article badges into message rendering**

  The rendering chain is: `AIMessage.tsx` line 65 → `MarkdownWrapper` (`components/markdownWrapper.tsx`) → `ReactMarkdown`. The cleanest approach: pre-process the text before it reaches ReactMarkdown by converting emoji patterns to inline HTML spans, then enable raw HTML in ReactMarkdown via `rehype-raw`.

  a) Install rehype-raw:
  ```bash
  pnpm add rehype-raw
  ```

  b) Add a utility function to `components/ArticleRenderer.tsx` for string pre-processing:
  ```typescript
  export function processArticlesForMarkdown(text: string): string {
    return text
      .replace(/🔵 der/g, '<span style="background:#1e40af;color:white;font-weight:700;padding:1px 6px;border-radius:4px;font-size:0.85em">der</span>')
      .replace(/🔴 die/g, '<span style="background:#b91c1c;color:white;font-weight:700;padding:1px 6px;border-radius:4px;font-size:0.85em">die</span>')
      .replace(/🟢 das/g, '<span style="background:#15803d;color:white;font-weight:700;padding:1px 6px;border-radius:4px;font-size:0.85em">das</span>');
  }
  ```

  c) Update `components/markdownWrapper.tsx` — add `rehype-raw` to the rehype plugins:
  ```tsx
  // Add import at top:
  import rehypeRaw from 'rehype-raw';

  // Change line (current):
  const rehypePlugins = useMemo(() => [rehypeKatex] as Array<any>, []);
  // To:
  const rehypePlugins = useMemo(() => [rehypeKatex, rehypeRaw] as Array<any>, []);
  ```

  d) Update `components/messages/AIMessage.tsx` line 65:
  ```tsx
  // Add import at top:
  import { processArticlesForMarkdown } from '@/components/ArticleRenderer';

  // Change line 65 from:
  <MarkdownWrapper text={content} />
  // To:
  <MarkdownWrapper text={processArticlesForMarkdown(content)} />
  ```

- [ ] **Step 6: Visual test**

  ```bash
  pnpm dev
  ```
  Chat: `"der Hund nasıl yazılır?"`
  Expected: The tutor's response shows a blue **der** badge before "Hund".

- [ ] **Step 7: Commit**

  ```bash
  git add components/ArticleRenderer.tsx components/messages/AIMessage.tsx tests/deutschmeister.test.ts
  git commit -m "feat: add article badge rendering (der=blue, die=red, das=green)"
  ```

---

## Task 10: Session Start Flow + Phase Indicator

**Files:**
- Create: `components/SessionPhaseIndicator.tsx`
- Modify: `app/Chat.tsx`

- [ ] **Step 1: Create SessionPhaseIndicator component**

  ```tsx
  // components/SessionPhaseIndicator.tsx
  'use client';

  type Phase = 'warmup' | 'lesson' | 'conversation' | null;

  interface SessionPhaseIndicatorProps {
    phase: Phase;
    lessonTopic?: string;
  }

  const PHASES: { id: Phase; label: string }[] = [
    { id: 'warmup', label: '🔥 Isıtma' },
    { id: 'lesson', label: '📚 Ders' },
    { id: 'conversation', label: '💬 Pratik' },
  ];

  export default function SessionPhaseIndicator({ phase, lessonTopic }: SessionPhaseIndicatorProps) {
    if (!phase) return null;

    return (
      <div className="flex items-center gap-2 px-3 py-1 text-xs border-b border-border">
        {PHASES.map((p, i) => (
          <span key={p.id} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <span className={phase === p.id ? 'font-semibold text-blue-500' : 'text-muted-foreground'}>
              {p.label}
            </span>
          </span>
        ))}
        {lessonTopic && (
          <span className="ml-2 text-muted-foreground">· {lessonTopic}</span>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 2: Add session start and phase state to Chat.tsx**

  In `app/Chat.tsx`, find where new conversations are created (look for `createConversation` call). Add:

  a) New state variables near existing `useState` declarations:
  ```tsx
  const [sessionPhase, setSessionPhase] = useState<'warmup' | 'lesson' | 'conversation' | null>(null);
  const [sessionTopic, setSessionTopic] = useState<string>('');
  ```

  b) A `startSession` function:
  ```tsx
  const startSession = async (conversationId: string) => {
    try {
      const res = await fetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      });
      const data = await res.json();
      setSessionPhase('warmup');
      setSessionTopic(data.lessonTopic ?? '');
    } catch {
      // non-critical — session tracking fails silently
    }
  };
  ```

  c) Call `startSession` when a new conversation is created. Find the existing `createConversation` usage and add the call after it. Example pattern:
  ```tsx
  const newConv = await createConversation(/* ... */);
  await startSession(newConv.id);
  setCurrentConversation(newConv);
  ```

  d) Import and render `SessionPhaseIndicator` in the chat layout. Find where the chat messages area is rendered and add the indicator above it:
  ```tsx
  import SessionPhaseIndicator from '@/components/SessionPhaseIndicator';

  // In the JSX, above the MessageList:
  <SessionPhaseIndicator phase={sessionPhase} lessonTopic={sessionTopic} />
  ```

- [ ] **Step 3: Verify session indicator appears**

  ```bash
  pnpm dev
  ```
  Create a new conversation. Expected: phase indicator appears showing "🔥 Isıtma → 📚 Ders → 💬 Pratik · Selamlaşma" with Isıtma highlighted.

- [ ] **Step 4: Commit**

  ```bash
  git add components/SessionPhaseIndicator.tsx app/Chat.tsx
  git commit -m "feat: add session start flow and phase indicator"
  ```

---

## Task 11: Vocabulary Panel

**Files:**
- Create: `components/VocabularyPanel.tsx`
- Modify: `app/Chat.tsx`

- [ ] **Step 1: Create VocabularyPanel component**

  ```tsx
  // components/VocabularyPanel.tsx
  'use client';

  import { useEffect, useState } from 'react';

  interface VocabCard {
    card_id: string;
    word: string;
    article: string;
    translation_tr: string;
    status: string;
  }

  interface PanelData {
    dueWords: VocabCard[];
    knownCount: number;
    totalCount: number;
  }

  const STATUS_COLORS: Record<string, string> = {
    new: 'bg-gray-100 dark:bg-gray-800',
    seen: 'bg-blue-50 dark:bg-blue-900/20',
    struggling: 'bg-red-50 dark:bg-red-900/20',
    known: 'bg-green-50 dark:bg-green-900/20',
  };

  export default function VocabularyPanel() {
    const [data, setData] = useState<PanelData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      fetch('/api/vocabulary/due')
        .then((r) => r.json())
        .then((d) => {
          setData(d);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, []);

    if (loading) {
      return (
        <div className="p-4 text-sm text-muted-foreground">Kelimeler yükleniyor...</div>
      );
    }

    if (!data) return null;

    const progressPct = data.totalCount > 0
      ? Math.round((data.knownCount / data.totalCount) * 100)
      : 0;

    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-sm mb-1">Kelime İlerlemesi</h3>
          <div className="text-xs text-muted-foreground mb-2">
            {data.knownCount} / {data.totalCount} ({progressPct}%)
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div
              className="bg-green-500 h-1.5 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
            Bugün Tekrar ({data.dueWords.length})
          </h4>
          {data.dueWords.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bugün tekrar edilecek kelime yok 🎉</p>
          ) : (
            data.dueWords.map((card) => (
              <div
                key={card.card_id}
                className={`mb-2 p-2 rounded-lg text-sm ${STATUS_COLORS[card.status] ?? ''}`}
              >
                <span className="font-medium">
                  {card.article !== '—' ? `${card.article} ` : ''}
                  {card.word}
                </span>
                <span className="text-muted-foreground ml-2 text-xs">{card.translation_tr}</span>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Add VocabularyPanel to Chat.tsx layout**

  The existing `Chat.tsx` uses `ResizablePanelGroup` from `react-resizable-panels` (already in deps). Find the `ResizablePanelGroup` in Chat.tsx and add a third panel for vocabulary.

  Import:
  ```tsx
  import VocabularyPanel from '@/components/VocabularyPanel';
  ```

  Add to the `ResizablePanelGroup`, after the existing chat panel:
  ```tsx
  <ResizableHandle />
  <ResizablePanel defaultSize={22} minSize={15} maxSize={35}>
    <VocabularyPanel />
  </ResizablePanel>
  ```

  Note: if `ResizablePanelGroup` is not already in Chat.tsx, wrap the chat content in one with `direction="horizontal"`.

- [ ] **Step 3: Verify panel renders**

  ```bash
  pnpm dev
  ```
  Expected: right-side panel showing "Kelime İlerlemesi" with progress bar and today's due words.

- [ ] **Step 4: Commit**

  ```bash
  git add components/VocabularyPanel.tsx app/Chat.tsx
  git commit -m "feat: add vocabulary panel with progress tracker and due word list"
  ```

---

## Task 12: End-to-End Smoke Test

- [ ] **Step 1: Run all tests**

  ```bash
  pnpm vitest run
  ```
  Expected: all tests pass.

- [ ] **Step 2: TypeScript check**

  ```bash
  pnpm tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 3: Full session walkthrough**

  With the dev server running:

  1. Sign in at http://localhost:3000
  2. Create a new conversation → session start triggers → phase indicator shows "🔥 Isıtma"
  3. Send: `"Merhaba!"` → tutor responds in Turkish as DeutschMeister, calls `get_due_words` tool
  4. Complete warmup: respond to 2-3 vocabulary cards with `"biliyorum"` / `"bilmiyorum"` — verify card statuses update in Supabase
  5. Confirm `der`/`die`/`das` appear as colored badges in the tutor's responses (🔵 blue / 🔴 red / 🟢 green)
  6. Progress through ders phase: tutor introduces 2-3 new words via `get_vocabulary_word` tool
  7. Enter conversation phase: tutor sets a scenario and you write a German sentence
  8. Make a deliberate error (e.g., write `"Ich bin heißen Anna"`) → confirm tutor corrects gently in Turkish
  9. Vocabulary panel on the right shows due words and progress bar

- [ ] **Step 4: Verify success criteria from spec**

  - [ ] Fork runs locally with DeutschMeister prompt active
  - [ ] `/api/chat` executes tool calls and returns vocabulary from DB (not hallucinated)
  - [ ] 🔵/🔴/🟢 article badges render in chat
  - [ ] Three-phase session arc flows correctly
  - [ ] `vocabulary_cards` seeded with A1 words
  - [ ] Card status updates after warmup ratings
  - [ ] `learning_sessions` row created per session
  - [ ] Works on mobile (resize browser to 375px width)

- [ ] **Step 5: Final commit**

  ```bash
  git add -A
  git commit -m "feat: complete DeutschMeister chat tutor core (sub-project 1)"
  ```

---

## Next Steps (Sub-project 2)

Once this is working and you've used it for a week, sub-project 2 adds:
- `pip install fsrs` + py-fsrs FSRS-6 scheduling replaces the simple interval logic in `updateWordReview`
- No schema changes needed — `stability` and `difficulty` columns are already in `vocabulary_cards`
- Expand `data/a1-vocabulary.json` to the full 650-word Goethe-Institut A1 list
