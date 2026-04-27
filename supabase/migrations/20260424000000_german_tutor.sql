-- Enums
CREATE TYPE card_status AS ENUM ('new', 'seen', 'struggling', 'known');
CREATE TYPE session_phase AS ENUM ('warmup', 'lesson', 'conversation', 'done');

-- vocabulary_cards
CREATE TABLE vocabulary_cards (
  card_id        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word           TEXT          NOT NULL,
  article        TEXT          NOT NULL DEFAULT '—',
  translation_tr TEXT          NOT NULL,
  example_sentence TEXT        NOT NULL,
  topic          TEXT          NOT NULL,
  pos            TEXT          NOT NULL,
  status         card_status   NOT NULL DEFAULT 'new',
  seen_count     INT           NOT NULL DEFAULT 0,
  last_seen_at   TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  stability      FLOAT,
  difficulty     FLOAT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
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
