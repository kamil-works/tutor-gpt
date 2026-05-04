import { createClient } from '@/utils/supabase/server';

export interface LearnerProfile {
  user_id: string;
  error_patterns: Record<string, number>;
  session_notes: string;
  avg_rating: number;
}

const DEFAULT_PROFILE: Omit<LearnerProfile, 'user_id'> = {
  error_patterns: {},
  session_notes: '',
  avg_rating: 3.0,
};

export async function getLearnerProfile(userId: string): Promise<LearnerProfile> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('learner_profiles')
    .select('user_id, error_patterns, session_notes, avg_rating')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return { user_id: userId, ...DEFAULT_PROFILE };
  return {
    user_id: data.user_id,
    error_patterns: (data.error_patterns as Record<string, number>) ?? {},
    session_notes: data.session_notes ?? '',
    avg_rating: data.avg_rating ?? 3.0,
  };
}

export async function updateErrorPattern(
  userId: string,
  errorType: string
): Promise<void> {
  const supabase = await createClient();
  const profile = await getLearnerProfile(userId);
  const updated = {
    ...profile.error_patterns,
    [errorType]: (profile.error_patterns[errorType] ?? 0) + 1,
  };
  await supabase
    .from('learner_profiles')
    .upsert(
      { user_id: userId, error_patterns: updated, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
}

export async function upsertLearnerProfile(
  userId: string,
  patch: Partial<Omit<LearnerProfile, 'user_id'>>
): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from('learner_profiles')
    .upsert(
      { user_id: userId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
}

export async function updateDrillCount(
  sessionId: string,
  isConversationTurn: boolean
): Promise<void> {
  const supabase = await createClient();
  if (isConversationTurn) {
    await supabase
      .from('learning_sessions')
      .update({ drill_count_since_conversation: 0 })
      .eq('session_id', sessionId);
  } else {
    const { data } = await supabase
      .from('learning_sessions')
      .select('drill_count_since_conversation')
      .eq('session_id', sessionId)
      .maybeSingle();
    const current = data?.drill_count_since_conversation ?? 0;
    await supabase
      .from('learning_sessions')
      .update({ drill_count_since_conversation: current + 1 })
      .eq('session_id', sessionId);
  }
}

export async function getDrillCount(sessionId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('learning_sessions')
    .select('drill_count_since_conversation')
    .eq('session_id', sessionId)
    .maybeSingle();
  return data?.drill_count_since_conversation ?? 0;
}
