import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { ChatCallProps } from './types';
import { formatStreamChunk } from '@/utils/ai/stream';
import { validateUser } from '@/utils/ai/validation';
import { fetchConversationHistory, saveConversation } from '@/utils/ai/conversation';
import { checkAndGenerateSummary } from '@/utils/ai/summary';
import { googleAI, GEMINI_MODEL } from '@/utils/ai';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { getNextWord, updateLastWordReview } from '@/utils/vocabulary';
import { getSessionContext } from '@/utils/sessions';
import { buildDeutschMeisterSystemPrompt } from '@/utils/prompts/deutschmeister';

const SENTRY_RELEASE = process.env.SENTRY_RELEASE || 'dev';
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || 'local';

export async function* respond({ message, conversationId }: ChatCallProps) {
  console.log('[respond] start, model:', GEMINI_MODEL);
  const userValidation = await validateUser();
  console.log('[respond] validation:', userValidation.isAuthorized, (userValidation as any).error ?? 'ok');
  if (!userValidation.isAuthorized) {
    return new NextResponse(userValidation.error, { status: userValidation.status });
  }
  const { userData } = userValidation;
  if (!userData) return new NextResponse('User data not found', { status: 500 });

  const { userId } = userData;
  console.log('[respond] userId:', userId.slice(0, 8) + '...');

  const [{ messages: messageHistory, summaries: summaryHistory }, sessionContext] =
    await Promise.all([
      fetchConversationHistory('', userId, conversationId),
      getSessionContext(userId, conversationId),
    ]);

  const conversationMessages = messageHistory.map((m) => ({
    role: m.is_user ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }));

  conversationMessages.push({ role: 'user', content: message });

  const lastSummary = summaryHistory[0]?.content;
  // Declared early so the after() closure captures it by reference; fully populated by the time after() runs
  let response = '';
  after(async () => {
    await saveConversation('', userId, conversationId, message, '', '', '', response);
    await checkAndGenerateSummary('', userId, conversationId, messageHistory, summaryHistory, lastSummary);
  });
  try {
    const result = streamText({
      model: googleAI(GEMINI_MODEL),
      system: buildDeutschMeisterSystemPrompt(sessionContext),
      messages: conversationMessages,
      maxSteps: 5,
      experimental_telemetry: {
        isEnabled: true,
        metadata: { sessionId: conversationId, userId, release: SENTRY_RELEASE, environment: SENTRY_ENVIRONMENT, tags: ['response'] },
      },
      tools: {
        get_next_word: tool({
          description: 'Get the next vocabulary word to teach. Returns an overdue review word first, then a new word. MUST be called before teaching any word.',
          parameters: z.object({}),
          execute: async () => {
            console.log('[tool] get_next_word');
            return getNextWord(userId, conversationId);
          },
        }),
        update_last_word_review: tool({
          description: 'Rate the last word shown after user responds. Call immediately after any user response to a word.',
          parameters: z.object({
            rating: z.number().describe('1=wrong/no idea, 2=hard/needs practice, 3=good/mostly right, 4=easy/perfect'),
          }),
          execute: async ({ rating }) => {
            console.log('[tool] update_last_word_review, rating:', rating);
            return updateLastWordReview(userId, conversationId, rating as 1 | 2 | 3 | 4);
          },
        }),
      },
    });

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        response += part.textDelta;
        yield formatStreamChunk({ type: 'response', text: part.textDelta });
      } else if (part.type === 'tool-call') {
        console.log('[respond] tool-call:', part.toolName, JSON.stringify(part.args));
      } else if (part.type === 'tool-result') {
        console.log('[respond] tool-result:', part.toolName, JSON.stringify(part.result).slice(0, 120));
      } else if (part.type === 'error') {
        console.error('[respond] stream error part:', part.error);
      } else if (part.type === 'finish') {
        console.log('[respond] finish, stopReason:', part.finishReason, 'steps:', (part as any).experimental_providerMetadata?.google);
      }
    }
  } catch (err) {
    console.error('[respond] fullStream error:', err);
    throw err;
  }
  console.log('[respond] done, response length:', response.length);

  return new NextResponse(response);
}
