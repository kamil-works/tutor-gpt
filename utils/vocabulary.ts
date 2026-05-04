import { createClient } from '@/utils/supabase/server';
import { fsrs, generatorParameters, Rating, createEmptyCard, type Card as FSRSCard } from 'ts-fsrs';

const f = fsrs(generatorParameters());

const ratingMap: Record<1 | 2 | 3 | 4, Rating> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

const statusMap: Record<number, 'struggling' | 'seen' | 'known'> = {
  [Rating.Again]: 'struggling',
  [Rating.Hard]: 'struggling',
  [Rating.Good]: 'seen',
  [Rating.Easy]: 'known',
};

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
  topic?: string,
  sessionId?: string
): Promise<VocabularyCard | null> {
  const supabase = await createClient();
  let query = supabase
    .from('vocabulary_cards')
    .select('card_id, word, article, translation_tr, example_sentence, topic, pos, status')
    .eq('user_id', userId)
    .eq('status', 'new')
    .order('created_at', { ascending: true })
    .limit(1);

  if (topic) query = (query as any).eq('topic', topic);

  const { data, error } = await query.single();
  if (error || !data) return null;

  // Mark as seen immediately so it won't be fetched again as "new"
  await supabase
    .from('vocabulary_cards')
    .update({ status: 'seen', last_seen_at: new Date().toISOString() })
    .eq('card_id', data.card_id);

  // Track last introduced word in session so update_last_word_review can find it
  if (sessionId) {
    const { data: session } = await supabase
      .from('learning_sessions')
      .select('words_introduced')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (session !== null) {
      const current = session.words_introduced ?? [];
      await supabase
        .from('learning_sessions')
        .update({ words_introduced: [...current, data.card_id] })
        .eq('session_id', sessionId);
    }
  }

  return data as VocabularyCard;
}

export async function updateLastWordReview(
  userId: string,
  sessionId: string,
  rating: 1 | 2 | 3 | 4
): Promise<{ next_review_at: string; status: string } | { error: string }> {
  const supabase = await createClient();

  const { data: session } = await supabase
    .from('learning_sessions')
    .select('words_introduced')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();

  const words = session?.words_introduced;
  if (!words?.length) return { error: 'No recent word to rate' };

  const lastCardId = words[words.length - 1];
  return updateWordReview(lastCardId, rating);
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
    .in('status', ['seen', 'struggling'])
    .lte('next_review_at', now)
    .order('next_review_at', { ascending: true })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as VocabularyCard[];
}

async function trackWordInSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
  userId: string,
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
  } else {
    await supabase
      .from('learning_sessions')
      .upsert(
        { session_id: sessionId, user_id: userId, words_introduced: [cardId], started_at: new Date().toISOString() },
        { onConflict: 'session_id' }
      );
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
    .in('status', ['seen', 'struggling', 'known'])
    .lte('next_review_at', now)
    .order('next_review_at', { ascending: true })
    .limit(1)
    .single();

  if (!dueError && dueWord) {
    if (sessionId) await trackWordInSession(supabase, sessionId, userId, dueWord.card_id);
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

  if (sessionId) await trackWordInSession(supabase, sessionId, userId, newWord.card_id);

  return newWord as VocabularyCard;
}

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

  // Build FSRS card from DB row, or start fresh if no FSRS data yet.
  // state === 0 means New — treat it as a fresh card to avoid invalid memory state errors.
  const hasReviewHistory = current?.stability != null && (current?.state ?? 0) > 0;
  const fsrsCard: FSRSCard = hasReviewHistory
    ? {
        due: new Date(),
        stability: current!.stability,
        difficulty: current!.difficulty,
        elapsed_days: current!.elapsed_days ?? 0,
        scheduled_days: 0,
        reps: current!.reps ?? 0,
        lapses: current!.lapses ?? 0,
        state: current!.state ?? 0,
        last_review: current!.last_seen_at ? new Date(current!.last_seen_at) : undefined,
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
