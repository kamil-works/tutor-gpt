import { Message, MetaMessage } from './types';
import { MAX_CONTEXT_SIZE, SUMMARY_SIZE } from './conversation';

// Summary generation is disabled — Honcho removed, short sessions don't need it.
export async function checkAndGenerateSummary(
  _appId: string,
  _userId: string,
  _conversationId: string,
  _messageHistory: Message[],
  _summaryHistory: MetaMessage[],
  _lastSummary?: string
) {
  return;
}
