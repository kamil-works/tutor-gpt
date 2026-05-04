import { generateText } from 'ai';
import { googleAI, GEMINI_OBSERVER_MODEL } from '@/utils/ai';
import { ThoughtHookOutput, THOUGHT_HOOK_FALLBACK } from '@/utils/ai/types';
import { buildObserverPrompt } from '@/utils/prompts/thought-observer';

interface ThoughtHookInput {
  recentMessages: { role: 'user' | 'assistant'; content: string }[];
  drillCount: number;
  errorPatterns: Record<string, number>;
  sessionNotes: string;
}

const VALID_MODES = new Set(['drill', 'conversation', 'sentence_production', 'grammar_note']);
const VALID_TECHNIQUES = new Set(['tr_to_de', 'de_to_tr', 'fill_blank', 'make_sentence', 'free_chat', 'error_correction']);
const VALID_DIFFICULTY = new Set(['too_easy', 'optimal', 'too_hard']);
const VALID_ERRORS = new Set(['article', 'verb_conjugation', 'word_order', 'vocabulary', null]);

function isValidOutput(obj: unknown): obj is ThoughtHookOutput {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    VALID_MODES.has(o.mode as string) &&
    VALID_TECHNIQUES.has(o.technique as string) &&
    VALID_DIFFICULTY.has(o.difficulty_signal as string) &&
    VALID_ERRORS.has(o.error_spotted as string | null) &&
    typeof o.drill_count === 'number' &&
    typeof o.teaching_note === 'string'
  );
}

export async function runThoughtHook(input: ThoughtHookInput): Promise<ThoughtHookOutput> {
  try {
    const systemPrompt = buildObserverPrompt(
      input.drillCount,
      input.errorPatterns,
      input.sessionNotes
    );

    const conversationText = input.recentMessages
      .slice(-6)
      .map((m) => `${m.role === 'user' ? 'Öğrenci' : 'Öğretmen'}: ${m.content}`)
      .join('\n');

    const { text } = await generateText({
      model: googleAI(GEMINI_OBSERVER_MODEL),
      system: systemPrompt,
      prompt: conversationText || 'Konuşma henüz başlamadı.',
      maxTokens: 200,
    });

    // Strip markdown code fences if present
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!isValidOutput(parsed)) return THOUGHT_HOOK_FALLBACK;
    return parsed;
  } catch {
    return THOUGHT_HOOK_FALLBACK;
  }
}
