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
