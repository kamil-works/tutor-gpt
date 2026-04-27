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

  if (topic) query = (query as any).eq('topic', topic);

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
