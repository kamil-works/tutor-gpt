'use server';

import { createClient } from '@/utils/supabase/server';
import * as Sentry from '@sentry/nextjs';
import { Conversation } from '@/utils/types';

export async function getConversations(): Promise<Conversation[]> {
  return Sentry.startSpan(
    { name: 'server-action.getConversations', op: 'server.action' },
    async () => {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Unauthorized');

      const { data, error } = await supabase
        .from('conversations')
        .select('id, name')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return (data ?? []).map((c) => ({ conversationId: c.id, name: c.name }));
    }
  );
}

export async function createConversation(): Promise<Conversation> {
  return Sentry.startSpan(
    { name: 'server-action.createConversation', op: 'server.action' },
    async () => {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Unauthorized');

      const { data, error } = await supabase
        .from('conversations')
        .insert({ user_id: user.id, name: 'Untitled' })
        .select('id, name')
        .single();

      if (error) throw error;
      return { conversationId: data.id, name: data.name };
    }
  );
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
  return Sentry.startSpan(
    { name: 'server-action.deleteConversation', op: 'server.action' },
    async () => {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Unauthorized');

      const { error } = await supabase
        .from('conversations')
        .update({ is_active: false })
        .eq('id', conversationId)
        .eq('user_id', user.id);

      if (error) throw error;
      return true;
    }
  );
}

export async function updateConversation(conversationId: string, name: string): Promise<boolean> {
  return Sentry.startSpan(
    { name: 'server-action.updateConversation', op: 'server.action' },
    async () => {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Unauthorized');

      const { error } = await supabase
        .from('conversations')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('user_id', user.id);

      if (error) throw error;
      return true;
    }
  );
}
