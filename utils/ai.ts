import { getHonchoApp, getHonchoUser } from '@/utils/honcho';
import { createClient } from '@/utils/supabase/server';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
  generateText as generateTextAi,
  streamText as streamTextAi,
  streamObject as streamObjectAi,
} from 'ai';
import d from 'dedent-js';
import * as Sentry from '@sentry/nextjs';
import { ZodTypeDef, ZodType } from 'zod';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SENTRY_RELEASE = process.env.SENTRY_RELEASE || 'dev';
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || 'local';

export const googleAI = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

export const GEMINI_MODEL = 'gemini-2.5-flash';

export async function getUserData() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const honchoApp = await getHonchoApp();
  const honchoUser = await getHonchoUser(user.id);

  return {
    appId: honchoApp.id,
    userId: honchoUser.id,
  };
}

export const user = (
  strings: TemplateStringsArray,
  ...values: unknown[]
): Message => ({
  role: 'user',
  content: d(strings, ...values),
});

export const assistant = (
  strings: TemplateStringsArray,
  ...values: unknown[]
): Message => ({
  role: 'assistant',
  content: d(strings, ...values),
});

export function streamText(
  params: Omit<
    Parameters<typeof streamTextAi>[0],
    'model' | 'experimental_telemetry'
  > & {
    metadata: {
      sessionId: string;
      userId: string;
      type: string;
    };
  }
) {
  return streamTextAi({
    ...params,
    model: googleAI(GEMINI_MODEL),
    experimental_telemetry: {
      isEnabled: true,
      metadata: {
        sessionId: params.metadata.sessionId,
        userId: params.metadata.userId,
        release: SENTRY_RELEASE,
        environment: SENTRY_ENVIRONMENT,
        tags: [params.metadata.type],
      },
    },
  });
}

export function streamObject<OBJECT>(
  params: Omit<
    Parameters<typeof streamObjectAi<OBJECT>>[0],
    'model' | 'experimental_telemetry' | 'schema'
  > & {
    schema: ZodType<OBJECT, ZodTypeDef, any>;
    metadata: {
      sessionId: string;
      userId: string;
      type: string;
    };
  }
) {
  return streamObjectAi({
    ...params,
    model: googleAI(GEMINI_MODEL),
    experimental_telemetry: {
      isEnabled: true,
      metadata: {
        sessionId: params.metadata.sessionId,
        userId: params.metadata.userId,
        release: SENTRY_RELEASE,
        environment: SENTRY_ENVIRONMENT,
        tags: [params.metadata.type],
      },
    },
  });
}

export function generateText(
  params: Omit<
    Parameters<typeof generateTextAi>[0],
    'model' | 'experimental_telemetry'
  > & {
    metadata: {
      sessionId: string;
      userId: string;
      type: string;
    };
  }
) {
  return generateTextAi({
    ...params,
    model: googleAI(GEMINI_MODEL),
    experimental_telemetry: {
      isEnabled: true,
      metadata: {
        sessionId: params.metadata.sessionId,
        userId: params.metadata.userId,
        release: SENTRY_RELEASE,
        environment: SENTRY_ENVIRONMENT,
        tags: [params.metadata.type],
      },
    },
  });
}

/** @deprecated Use generateText instead */
export async function createCompletion(
  messages: Message[],
  metadata: {
    sessionId: string;
    userId: string;
    type: string;
  },
  parameters?: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
  }
) {
  const result = await generateTextAi({
    model: googleAI(GEMINI_MODEL),
    messages,
    ...parameters,
  });
  return result.text;
}
