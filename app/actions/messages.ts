'use server';

import { createClient } from '@/utils/supabase/server';
import { Message } from '@/utils/types';
import * as Sentry from '@sentry/nextjs';

export async function getMessages(conversationId: string): Promise<Message[]> {
  return Sentry.startSpan(
    { name: 'server-action.getMessages', op: 'server.action' },
    async () => {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Unauthorized');

      const { data, error } = await supabase
        .from('messages')
        .select('id, is_user, content, metadata')
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data ?? []).map((m) => ({
        id: m.id,
        content: m.content,
        isUser: m.is_user,
        metadata: m.metadata ?? {},
      }));
    }
  );
}

export async function getThought(_conversationId: string, _messageId: string) {
  return null;
}

export async function addOrRemoveReaction(
  conversationId: string,
  messageId: string,
  reaction: 'thumbs_up' | 'thumbs_down' | null
) {
  return Sentry.startSpan(
    { name: 'server-action.addOrRemoveReaction', op: 'server.action' },
    async () => {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Unauthorized');

      const { data: msg } = await supabase
        .from('messages')
        .select('metadata')
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .single();

      const metadata = { ...(msg?.metadata ?? {}) };
      if (reaction === null) {
        delete metadata.reaction;
      } else {
        metadata.reaction = reaction;
      }

      await supabase
        .from('messages')
        .update({ metadata })
        .eq('id', messageId)
        .eq('user_id', user.id);
    }
  );
}
