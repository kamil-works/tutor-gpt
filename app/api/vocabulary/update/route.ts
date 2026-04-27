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
