import { createClient } from '@/utils/supabase/server';
import { SessionContext } from '@/utils/ai/types';
import { getNextLessonTopic } from '@/utils/lessons';
import { getLearnerProfile, getDrillCount, LearnerProfile } from '@/utils/db/learner-profile';

export async function getSessionContext(
  userId: string,
  conversationId: string
): Promise<SessionContext & { learnerProfile: LearnerProfile; drillCount: number }> {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const [sessionResult, lastSessionResult, knownResult, dueResult, learnerProfile, drillCount] = await Promise.all([
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
      .in('status', ['seen', 'struggling'])
      .lte('next_review_at', now),
    getLearnerProfile(userId),
    getDrillCount(conversationId),
  ]);

  const lastTopic = lastSessionResult.data?.lesson_topic ?? null;
  const lessonTopic =
    sessionResult.data?.lesson_topic ?? getNextLessonTopic(lastTopic);

  return {
    lessonTopic,
    lastTopic,
    knownCount: knownResult.count ?? 0,
    dueCount: dueResult.count ?? 0,
    learnerProfile,
    drillCount,
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
