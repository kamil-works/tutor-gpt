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
import { getVocabularyWord, getDueWords, updateWordReview } from '@/utils/vocabulary';
import { getSessionContext } from '@/utils/sessions';
import { buildDeutschMeisterSystemPrompt } from '@/utils/prompts/deutschmeister';

const SENTRY_RELEASE = process.env.SENTRY_RELEASE || 'dev';
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || 'local';

export async function* respond({ message, conversationId }: ChatCallProps) {
  const userValidation = await validateUser();
  if (!userValidation.isAuthorized) {
    return new NextResponse(userValidation.error, { status: userValidation.status });
  }
  const { userData } = userValidation;
  if (!userData) return new NextResponse('User data not found', { status: 500 });

  const { userId } = userData;

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
  after(async () => {
    await checkAndGenerateSummary('', userId, conversationId, messageHistory, summaryHistory, lastSummary);
  });

  const { textStream } = streamText({
    model: googleAI(GEMINI_MODEL),
    system: buildDeutschMeisterSystemPrompt(sessionContext),
    messages: conversationMessages,
    maxSteps: 5,
    experimental_telemetry: {
      isEnabled: true,
      metadata: {
        sessionId: conversationId,
        userId,
        release: SENTRY_RELEASE,
        environment: SENTRY_ENVIRONMENT,
        tags: ['response'],
      },
    },
    tools: {
      get_vocabulary_word: tool({
        description: 'Fetch a vocabulary word from the database. MUST be called before teaching any German word.',
        parameters: z.object({
          level: z.enum(['A1']).describe('CEFR level'),
          topic: z.string().optional().describe('Optional topic filter'),
        }),
        execute: async ({ level, topic }) => getVocabularyWord(userId, level, topic),
      }),
      get_due_words: tool({
        description: 'Fetch vocabulary cards due for review today. Call at the start of warmup phase.',
        parameters: z.object({
          limit: z.number().default(8).describe('Max number of cards to return'),
        }),
        execute: async ({ limit }) => getDueWords(userId, limit),
      }),
      update_word_review: tool({
        description: 'Update a card review status after user responds. rating: 1=wrong, 2=hard, 3=good, 4=easy.',
        parameters: z.object({
          word_id: z.string().describe('The card_id of the vocabulary card'),
          rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
        }),
        execute: async ({ word_id, rating }) => updateWordReview(word_id, rating),
      }),
    },
  });

  let response = '';
  for await (const chunk of textStream) {
    response += chunk;
    yield formatStreamChunk({ type: 'response', text: chunk });
  }

  await saveConversation('', userId, conversationId, message, '', '', '', response);

  return new NextResponse(response);
}
