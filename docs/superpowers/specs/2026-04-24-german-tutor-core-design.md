# German Tutor — Chat Tutor Core (Sub-project 1)

**Date:** 2026-04-24  
**Scope:** Sub-project 1 of 5. Establishes the working chat tutor with vocabulary layer.  
**Sub-projects 2–5:** FSRS scheduling, Speech pipeline, Adaptive LangGraph agents, Analytics dashboard.

---

## 1. Context & Decisions

| Question | Decision |
|---|---|
| Who is this for? | Single user (builder = learner). No multi-tenancy. |
| Platform | Web app (responsive PWA). Tutor-GPT fork — frontend already built. |
| Learner level | A1 — complete beginner, Turkish native speaker |
| Explanation language | Turkish. German only for target language examples. |
| Session structure | Three phases: Isıtma → Ders → Konuşma Pratiği |
| Voice | Out of scope for sub-project 1. Text only. |
| Base repository | Fork of [Tutor-GPT](https://github.com/plastic-labs/tutor-gpt) |
| LLM | Gemini 2.0 Flash via Google AI Studio API (direct). Free tier: 1,500 req/day — likely free for personal use. Supports tool calling natively. |
| Approach chosen | Tutor-GPT fork + tool calling added to `/api/chat` + vocabulary layer in Supabase |

---

## 2. Architecture

```
Browser (desktop + mobile responsive)
        ↕
Next.js 14 frontend — Tutor-GPT fork
  ├── Chat UI (existing, unchanged)
  ├── Vocabulary review panel (new)
  └── Session history view (new)
        ↕
Next.js API routes
  ├── /api/chat               (modified — adds tool calling support)
  ├── /api/session/start      (new — creates session row, fetches due cards)
  ├── /api/vocabulary/due     (new — used by vocabulary panel in UI)
  └── /api/vocabulary/update  (new — used by vocabulary panel in UI)
  Note: LLM-triggered vocabulary operations go through tool calls
  inside /api/chat, not through the panel routes.
        ↕
  ┌─────────────────┬──────────────────┐
  │ LLM             │ Memory           │
  │ Gemini 2.0      │ Honcho (existing)│
  │ Flash (default) │ conversation     │
  │ via Google AI Studio  │ history +        │
  │                 │ learner profile  │
  └─────────────────┴──────────────────┘
        ↕
Supabase (PostgreSQL)
  ├── users              (existing)
  ├── conversations      (existing)
  ├── vocabulary_cards   (new)
  └── learning_sessions  (new)
```

---

## 3. Data Model

### 3.1 `vocabulary_cards`

Seeded with ~650 words from the Goethe-Institut A1 official word list.

| Column | Type | Notes |
|---|---|---|
| card_id | uuid PK | |
| user_id | uuid FK | → users |
| word | text | e.g. "kaufen" |
| article | text | der / die / das / — (for non-nouns) |
| translation_tr | text | Turkish translation |
| example_sentence | text | German A1-level example |
| topic | text | Goethe-Institut topic category (e.g. "Familie", "Arbeit") |
| pos | text | noun / verb / adj / adv |
| status | enum | new / seen / struggling / known |
| seen_count | int | default 0 |
| last_seen_at | timestamptz | |
| next_review_at | timestamptz | simple interval scheduling (sub-project 1) |
| stability | float | null — populated by py-fsrs in sub-project 2 |
| difficulty | float | null — populated by py-fsrs in sub-project 2 |
| created_at | timestamptz | default now() |

**Warmup rating → tool rating mapping:**
- `biliyorum` → `update_word_review rating=3` (good)
- `zorlandım` → `update_word_review rating=2` (hard)
- `bilmiyorum` → `update_word_review rating=1` (wrong)

**Review scheduling (sub-project 1 — simple interval):**
- `new` → show after 1 day
- `seen` → show after 3 days
- `struggling` → show same day
- `known` → show after 7 days

This logic is replaced entirely by py-fsrs in sub-project 2. No schema migration needed.

### 3.2 `learning_sessions`

One row per study session.

| Column | Type | Notes |
|---|---|---|
| session_id | uuid PK | |
| user_id | uuid FK | → users |
| started_at | timestamptz | |
| ended_at | timestamptz | null if in progress |
| phase_reached | enum | warmup / lesson / conversation / done |
| lesson_topic | text | e.g. "Selamlaşma" |
| words_reviewed | uuid[] | card_ids shown during warmup |
| words_introduced | uuid[] | new card_ids taught this session |
| corrections_count | int | number of inline corrections made |
| session_summary | text | LLM-generated Turkish summary at session end |

---

## 4. Session Flow

Every session follows a fixed three-phase arc. Transitions happen naturally in chat — the LLM guides the user from phase to phase.

```
User clicks "Yeni Ders Başlat"
        ↓
API creates learning_session row
API fetches due vocabulary cards
System prompt injected with session context
        ↓
┌─────────────────────────────────────────┐
│  PHASE 1: ISITMA (~5 min)               │
│  Vocabulary warmup                      │
│  • Tutor shows 5–8 due cards one by one │
│  • Format: emoji+article, TR translation│
│    + example sentence                   │
│  • User rates: biliyorum /              │
│    zorlandım / bilmiyorum               │
│  • API updates card status + next_review│
└─────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────┐
│  PHASE 2: DERS (~10–15 min)             │
│  Structured lesson                      │
│  • Topic auto-selected from A1          │
│    progression (see §6)                 │
│  • Explanation in Turkish, examples     │
│    in German                            │
│  • 3–5 new words introduced → added     │
│    to vocabulary_cards                  │
│  • Mini-quiz: 2–3 questions             │
└─────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────┐
│  PHASE 3: KONUŞMA PRATİĞİ (~10 min)    │
│  Free conversation practice             │
│  • Tutor sets a scenario using          │
│    today's vocabulary                   │
│  • User writes freely in German         │
│  • Inline corrections in Turkish        │
│  • User can ask questions freely        │
└─────────────────────────────────────────┘
        ↓
Ders Sonu: LLM generates Turkish summary
learning_session updated (ended_at, summary,
words_reviewed, words_introduced, corrections_count)
```

---

## 5. System Prompt Design

Four blocks, ordered by priority. Most critical rules first so the LLM reads them before anything else.

### Block 1 — Anti-Hallucination Gate (~120 tokens)

```
Almanca kelime öğretmeden önce MUTLAKA tool çağır:

| Durum | Tool |
|-------|------|
| Yeni kelime öğreteceksin          | get_vocabulary_word |
| Öğrenci Türkçe kelime soruyor     | get_vocabulary_word |
| Ders başında tekrar kelimeleri    | get_due_words       |
| Öğrenci kelimeyi doğru söyledi    | update_word_review rating=3 |
| Öğrenci kelimeyi yanlış söyledi   | update_word_review rating=1 |

NEDEN: Kendi bilginden artikel üretme. Yanlış artikel,
hiç artikel vermemekten daha kötüdür.
```

### Block 2 — Artikel Color System (~80 tokens)

```
Her ismi DAIMA emoji+artikel ile yaz:
🔵 der = eril  →  🔵 der Hund
🔴 die = dişil →  🔴 die Katze
🟢 das = nötr  →  🟢 das Buch

Öğrenci artikelsiz yazarsa: "Harika! Sadece: 🔵 der Hund"
Asla sadece "Hund" yazma.
```

### Block 3 — Persona & Dil Kuralları (~100 tokens)

```
Sen DeutschMeister'sın — Türkçe konuşan bir Almanca öğretmenisin.
Açıklamalar DAIMA Türkçe. Almanca hedefler Almanca yazılır.
Sıcak, teşvik edici, sabırlı. Kısa ve net mesajlar.
Almanca kelimeler **kalın**. Her mesaj bir soru veya pratik ile biter.
Hata düzeltme: "✓ Güzel! Sadece: [doğrusu]" — önce onayla, sonra düzelt.
Kaygı seviyesi {anxiety_signal}: low=açıkça düzelt / medium=nazikçe / high=sadece doğruyu tekrar et.
```

### Block 4 — Dynamic Session Context (~150–250 tokens, built from DB)

```
[OTURUM PLANI]
Seviye: A1 | Kaygı: {anxiety_signal}
Son konu: {last_topic} | Bilinen kelime: {known_count}/650
Bugünkü konu: {lesson_topic}
Isıtma kelimeleri: {due_count} adet (get_due_words ile çek)
Oturumu başlat: kısa hoş geldin (1 cümle) → ısıtmaya geç.
```

**Total prompt size: ~450–550 tokens.** `anxiety_signal` defaults to `medium` in sub-project 1.  
**Cost estimate:** Free tier (1,500 req/day) covers personal use entirely. Pay-as-you-go only if exceeded.

---

## 6. Tool Calling Implementation

Tutor-GPT's existing `/api/chat` does not support tool calling. We modify it to use OpenAI's `tools` parameter (works via Google AI Studio).

### Tool Definitions (sent with every chat request)

```typescript
const tools = [
  {
    type: "function",
    function: {
      name: "get_vocabulary_word",
      description: "Fetch a vocabulary word from the database by level/topic. Call this before teaching any German word.",
      parameters: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["A1"], description: "CEFR level" },
          topic: { type: "string", description: "Optional Goethe topic filter" }
        },
        required: ["level"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_due_words",
      description: "Fetch vocabulary cards due for review today.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", default: 8 }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_word_review",
      description: "Update a card's review status after the user responds.",
      parameters: {
        type: "object",
        properties: {
          word_id: { type: "string" },
          rating: { type: "number", enum: [1, 2, 3, 4], description: "1=wrong, 2=hard, 3=good, 4=easy" }
        },
        required: ["word_id", "rating"]
      }
    }
  }
]
```

### Tool Execution Loop in `/api/chat`

```
1. Send message + tools to LLM
2. If LLM responds with tool_call:
   a. Execute the tool (DB query via Supabase client)
   b. Append tool_result to messages
   c. Send back to LLM → get final text response
3. If LLM responds with text: stream to frontend as normal
```

---

## 7. Article Color Rendering (Frontend)

The LLM outputs article emojis (🔵/🔴/🟢) in its text. The frontend post-processes chat messages to replace these with colored badges before rendering.

```typescript
// In chat message renderer
function renderArticles(text: string): string {
  return text
    .replace(/🔵 der/g, '<span class="article der">der</span>')
    .replace(/🔴 die/g, '<span class="article die">die</span>')
    .replace(/🟢 das/g, '<span class="article das">das</span>')
}
```

```css
.article { font-weight: 700; padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }
.article.der { background: #1e40af; color: white; }   /* blue */
.article.die { background: #b91c1c; color: white; }   /* red  */
.article.das { background: #15803d; color: white; }   /* green */
```

---

## 8. A1 Lesson Topic Progression

Topics follow Goethe-Institut A1 curriculum order. Stored in a constant array; `last_session_topic` determines the next.

```
Week 1: Selamlaşma → Kendini tanıtma → Sayılar (1–20) → Renkler
Week 2: Aile üyeleri → Meslekler → Günlük nesneler → Yiyecek & içecek
Week 3: Günler & aylar → Saat kaç? → Hava durumu → Ev & odalar
Week 4: Alışveriş → Ulaşım → Vücut → Duygular & sıfatlar
```

---

## 9. Vocabulary Seeding

Goethe-Institut A1 PDF (~650 words) is parsed and loaded into `vocabulary_cards` as a one-time seed script (`scripts/seed-vocabulary.ts`). Each word includes: German word, article, Turkish translation (LLM-assisted translation pass), example sentence, topic, POS.

---

## 10. Out of Scope (Sub-projects 2–5)

| Feature | Sub-project |
|---|---|
| FSRS scheduling (py-fsrs) replaces simple interval | 2 |
| CEFR progression beyond A1 | 2 |
| Speech input/output (Whisper + TTS) | 3 |
| LangGraph adaptive agents | 4 |
| Anxiety signal auto-detection | 4 |
| Analytics dashboard | 5 |

---

## 11. Success Criteria for Sub-project 1

- [ ] Fork runs locally with German tutor system prompt active
- [ ] `/api/chat` executes tool calls and returns correct vocabulary from DB
- [ ] 🔵/🔴/🟢 article badges render correctly in chat
- [ ] Session phases (warmup → lesson → conversation) flow correctly
- [ ] `vocabulary_cards` table seeded with A1 words
- [ ] Card status updates after warmup ratings
- [ ] `learning_sessions` row created and closed per session
- [ ] Session summary generated in Turkish at end of session
- [ ] Works on mobile browser (responsive)
