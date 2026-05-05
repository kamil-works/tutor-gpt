export interface ChatCallProps {
  message: string;
  conversationId: string;
  fileContent?: Promise<string[]>;
}

export interface StreamResponseChunk {
  type: 'thought' | 'honcho' | 'response' | 'pdf' | 'honchoQuery' | 'pdfQuery';
  text: string;
}

export interface Message {
  id: string;
  is_user: boolean;
  content: string;
}

export interface MetaMessage {
  message_id: string | null;
  content: string;
}

export interface UserData {
  appId: string;
  userId: string;
}

export interface ValidationResult {
  isAuthorized: boolean;
  error?: string;
  status?: number;
  userData?: UserData;
  supabaseUser?: any;
}

export interface ConversationHistory {
  messages: Message[];
  thoughts: MetaMessage[];
  honchoMessages: MetaMessage[];
  pdfMessages: MetaMessage[];
  summaries: MetaMessage[];
  collectionId?: string;
}

export interface SessionContext {
  lessonTopic: string;
  lastTopic: string | null;
  knownCount: number;
  dueCount: number;
  /** @deprecated kept for backward compat, not used in prompt */
  anxietySignal?: 'low' | 'medium' | 'high';
  thoughtHook?: ThoughtHookOutput;
}

export type TeachingMode = 'drill' | 'conversation' | 'sentence_production' | 'grammar_note';
export type TeachingTechnique = 'tr_to_de' | 'de_to_tr' | 'fill_blank' | 'make_sentence' | 'free_chat' | 'error_correction';
export type DifficultySignal = 'too_easy' | 'optimal' | 'too_hard';
export type ErrorType = 'article' | 'verb_conjugation' | 'word_order' | 'vocabulary';

export interface ThoughtHookOutput {
  mode: TeachingMode;
  technique: TeachingTechnique;
  difficulty_signal: DifficultySignal;
  error_spotted: ErrorType | null;
  drill_count: number;
  teaching_note: string;
}

export const THOUGHT_HOOK_FALLBACK: ThoughtHookOutput = {
  mode: 'drill',
  technique: 'tr_to_de',
  difficulty_signal: 'optimal',
  error_spotted: null,
  drill_count: 0,
  teaching_note: 'Başlangıç: kelime çalışmasıyla başla.',
};
