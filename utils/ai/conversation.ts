import { createClient } from '@/utils/supabase/server';
import { ConversationHistory } from './types';

export const MAX_CONTEXT_SIZE = 11;
export const SUMMARY_SIZE = 5;

export async function fetchConversationHistory(
  _appId: string,
  userId: string,
  conversationId: string
): Promise<ConversationHistory> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('messages')
    .select('id, is_user, content, metadata')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_CONTEXT_SIZE);

  const messages = (data ?? []).reverse().map((m) => ({
    id: m.id,
    is_user: m.is_user,
    content: m.content,
  }));

  return {
    messages,
    thoughts: [],
    honchoMessages: [],
    pdfMessages: [],
    summaries: [],
    collectionId: undefined,
  };
}

export async function saveConversation(
  _appId: string,
  userId: string,
  conversationId: string,
  userMessage: string,
  _thought: string,
  _honchoContent: string,
  _pdfContent: string,
  response: string,
  _collectionId?: string
) {
  const supabase = await createClient();

  await supabase.from('messages').insert([
    {
      conversation_id: conversationId,
      user_id: userId,
      is_user: true,
      content: userMessage,
      metadata: {},
    },
    {
      conversation_id: conversationId,
      user_id: userId,
      is_user: false,
      content: response,
      metadata: {},
    },
  ]);

  // Keep conversation updated_at fresh
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('user_id', userId);
}
