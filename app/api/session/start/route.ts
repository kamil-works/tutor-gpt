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

  const { data: lastSession } = await supabase
    .from('learning_sessions')
    .select('lesson_topic')
    .eq('user_id', userId)
    .not('ended_at', 'is', null)
    .order('ended_at', { ascending: false })
    .limit(1)
    .single();

  const lessonTopic = getNextLessonTopic(lastSession?.lesson_topic ?? null);

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
