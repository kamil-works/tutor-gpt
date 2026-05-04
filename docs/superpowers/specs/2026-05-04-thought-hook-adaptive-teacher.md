# DeutschMeister Adaptive Teacher — Design Spec

**Date:** 2026-05-04  
**Status:** Approved  
**Scope:** Sub-project 2 — Thought Hook + FSRS + Error Tracking

---

## Problem

The current system behaves like a flashcard machine: `get_next_word → present word → wait for answer → rate → repeat`. The model defaults to mechanical behavior because it must decide "what mode am I in?" and "how do I respond?" in a single pass. Prompt changes have not fixed this — the root cause is architectural, not instructional.

## Goal

Transform DeutschMeister from a vocabulary drill bot into an adaptive conversational teacher that:
- Alternates naturally between vocabulary drill and conversation practice
- Varies question format based on student confidence
- Tracks error patterns and focuses on weak areas
- Uses FSRS for scientifically-grounded scheduling

---

## Architecture: Two-Pass Flow

Every user message triggers two sequential LLM calls:

```
User message arrives
        ↓
[Pass 1: Observer] — Thought Hook
  Input:  last 6 messages + learner profile + session drill count + recent ratings
  Output: JSON { mode, technique, difficulty_signal, error_spotted, teaching_note }
        ↓
[Pass 2: Teacher] — Main Response
  Input:  static base prompt + <teacher_guidance> block (from Pass 1) + conversation history
  Tools:  get_next_word, update_last_word_review
  Output: response to student
        ↓
Student sees response
```

**Why this works:** The observer decides *what* to do; the teacher decides *how* to do it. The teacher never has to manage mode — it just executes one technique well.

**Models:** Thought Hook uses `gemini-2.0-flash` (fast, cheap, JSON extraction). Main teacher uses `gemini-2.5-flash` (unchanged).

**Latency:** Thought Hook max 150 output tokens → ~0.5–1s additional per turn.

---

## Pass 1: Thought Hook

### Inputs

| Input | Source |
|---|---|
| Last 6 messages | `messages` table |
| `error_patterns` | `learner_profiles.error_patterns` |
| `session_notes` | `learner_profiles.session_notes` |
| `avg_rating` | `learner_profiles.avg_rating` (last 10 ratings) |
| `drill_count_since_conversation` | `learning_sessions.drill_count_since_conversation` |

### Output (JSON, max 150 tokens)

```json
{
  "mode": "drill" | "conversation" | "sentence_production" | "grammar_note",
  "technique": "tr_to_de" | "de_to_tr" | "fill_blank" | "make_sentence" | "free_chat" | "error_correction",
  "difficulty_signal": "too_easy" | "optimal" | "too_hard",
  "error_spotted": null | "article" | "verb_conjugation" | "word_order" | "vocabulary",
  "drill_count": 2,
  "teaching_note": "human-readable instruction for the teacher, 1 sentence"
}
```

### Decision Logic

**Mode transitions:**
- `drill_count_since_conversation >= 3` → suggest `sentence_production` or `conversation`
- After a conversation exchange → reset `drill_count_since_conversation = 0`, return to `drill`

**Desirable Difficulty (60–70% success target):**
Ratings are extracted from the last 3 `update_last_word_review` tool-result entries visible in conversation history (not from `avg_rating` DB field — that's a long-term signal only).
- Last 3 ratings average > 3.5 → `difficulty_signal: "too_easy"` → use harder technique (fill_blank, make_sentence) or omit hints
- Last 3 ratings average < 2.0 → `difficulty_signal: "too_hard"` → use easier technique (tr_to_de with hint), add encouragement
- Otherwise → `difficulty_signal: "optimal"`

**Error focus:**
- If `error_patterns.article > 3` → prefer techniques that emphasize article (fill_blank with article slot)
- `error_spotted` updates `learner_profiles.error_patterns` cumulatively after each turn

**Fallback:** If Thought Hook fails or returns invalid JSON → default to `{ mode: "drill", technique: "tr_to_de", difficulty_signal: "optimal", error_spotted: null }`

---

## Pass 2: Teacher System Prompt

### Static Base (every turn, unchanged)

```
Sen DeutschMeister'sın — Türkçe konuşan A1 öğrencisine özel Almanca öğretmeni.
Araçların: get_next_word (yeni kelime getir), update_last_word_review (kelimeyi puanla).
Artikel kuralı: 🔵 der | 🔴 die | 🟢 das — asla artikelsiz yazma.
Kısa mesajlar. Samimi, sıcak ton. Hata varsa önce onayla: "✓ Güzel! Sadece: [doğrusu]"
Bilinen kelime: ${knownCount}/650
```

### Dynamic Block (injected each turn by Thought Hook)

```xml
<teacher_guidance>
MODE: conversation
TECHNIQUE: free_chat
DIFFICULTY: optimal
ERROR_FOCUS: article
NOTE: 3 ardışık doğru cevap. Sohbet aç — "Bugün nasılsın?" ile başla. Article hatası varsa 🔵/🔴/🟢 vurgula.
</teacher_guidance>
```

The teacher reads this block and acts accordingly. There is no rigid loop instruction. `get_next_word` is called when the teacher chooses, not on every turn. `update_last_word_review` is only relevant during `drill` mode — during `free_chat` or `sentence_production`, the teacher assesses the student naturally without a rating call.

---

## Teaching Techniques

| Technique | What the teacher does |
|---|---|
| `tr_to_de` | Gives Turkish word, asks for German + article |
| `de_to_tr` | Gives German word, asks for Turkish meaning |
| `fill_blank` | "Ich ___ Brot." — fill in the blank in a sentence |
| `make_sentence` | "Bu kelimeyi kullanarak bir cümle kur" |
| `free_chat` | 2–3 turn German mini-conversation using known vocabulary |
| `error_correction` | Address spotted error first, then continue |

---

## FSRS Integration

Replace fixed intervals in `utils/vocabulary.ts → updateWordReview` with `ts-fsrs` algorithm.

**Package:** `ts-fsrs` (npm)

**Rating mapping:**
| Our rating | FSRS Rating |
|---|---|
| 1 (wrong) | `Rating.Again` |
| 2 (hard) | `Rating.Hard` |
| 3 (good) | `Rating.Good` |
| 4 (easy) | `Rating.Easy` |

**DB columns already exist:** `stability`, `difficulty`, `elapsed_days`, `reps`, `lapses` — currently unused. FSRS populates all of them.

**Change scope:** Only `updateWordReview` in `utils/vocabulary.ts` changes. No schema migration needed.

---

## Data Model Changes

### New table: `learner_profiles`

```sql
create table learner_profiles (
  user_id        uuid primary key references auth.users,
  error_patterns jsonb    default '{}',
  session_notes  text     default '',
  avg_rating     numeric  default 3.0,
  updated_at     timestamptz default now()
);
```

- `error_patterns`: `{ "article": 5, "verb_conjugation": 2 }` — cumulative counts, updated after each turn where `error_spotted != null`
- `session_notes`: 1–2 sentence running summary updated by Thought Hook when `error_spotted != null` for 2+ consecutive turns, or when a mode transition (drill→conversation) occurs
- `avg_rating`: rolling average of last 10 ratings, used for Desirable Difficulty calculation

### Existing table: `learning_sessions`

```sql
alter table learning_sessions
  add column drill_count_since_conversation int default 0;
```

Reset to 0 on conversation/sentence_production turn. Incremented on each drill turn.

### Existing table: `vocabulary_cards`

No changes. `stability`, `difficulty`, `elapsed_days`, `reps`, `lapses` columns already exist — FSRS will populate them.

---

## ITS Module Alignment

| ITS Module | DeutschMeister Component |
|---|---|
| Expert Module | `vocabulary_cards` + static grammar knowledge in prompt |
| Student Model | `learner_profiles` (error_patterns, avg_rating, session_notes) |
| Tutor Module | Thought Hook (observer + technique selector) |
| Interface | Next.js chat UI (unchanged) |

---

## Future (Sub-project 3+)

- **Knowledge Space Theory:** Prerequisite graph — "Dativ edatları require Dativ vakası." Thought Hook detects missing prerequisites.
- **CEFR content control:** Add `complexity_target: "A1"` to teacher guidance to prevent the teacher from using B1+ language.
- **Speech:** Whisper + TTS pipeline for speaking practice.
- **RAG:** Relevant at B1+ when grammar rules become complex enough to hallucinate.

---

## Files Changed

| File | Change |
|---|---|
| `utils/ai/thought.ts` | **New** — Thought Hook LLM call |
| `utils/prompts/thought-observer.ts` | **New** — Observer system prompt |
| `utils/db/learner-profile.ts` | **New** — Read/write learner_profiles |
| `utils/vocabulary.ts` | **Modify** — updateWordReview → FSRS |
| `utils/ai/index.ts` | **Modify** — call thought hook before streamText, inject teacher_guidance |
| `utils/prompts/deutschmeister.ts` | **Modify** — remove rigid loop, add teacher_guidance injection |
| `utils/sessions.ts` | **Modify** — extend SessionContext, read learner profile |
| `utils/ai/types.ts` | **Modify** — add ThoughtHookOutput type |
| Supabase migration | **New** — learner_profiles table + drill_count_since_conversation column |
