import { describe, it, expect } from 'vitest';
import { buildDeutschMeisterSystemPrompt, type SessionContext } from '@/utils/prompts/deutschmeister';
import { getNextLessonTopic, A1_LESSON_PROGRESSION } from '@/utils/lessons';

describe('buildDeutschMeisterSystemPrompt', () => {
  const ctx: SessionContext = {
    lessonTopic: 'Selamlaşma',
    lastTopic: null,
    knownCount: 0,
    dueCount: 5,
    anxietySignal: 'medium',
  };

  it('includes the anti-hallucination tool table', () => {
    const prompt = buildDeutschMeisterSystemPrompt(ctx);
    expect(prompt).toContain('get_vocabulary_word');
    expect(prompt).toContain('get_due_words');
    expect(prompt).toContain('update_word_review');
  });

  it('includes the article color system', () => {
    const prompt = buildDeutschMeisterSystemPrompt(ctx);
    expect(prompt).toContain('🔵 der');
    expect(prompt).toContain('🔴 die');
    expect(prompt).toContain('🟢 das');
  });

  it('injects session context', () => {
    const prompt = buildDeutschMeisterSystemPrompt(ctx);
    expect(prompt).toContain('Selamlaşma');
    expect(prompt).toContain('0/650');
    expect(prompt).toContain('5 adet');
  });

  it('reflects anxiety signal', () => {
    const highCtx: SessionContext = { ...ctx, anxietySignal: 'high' };
    const prompt = buildDeutschMeisterSystemPrompt(highCtx);
    expect(prompt).toContain('high');
  });
});

describe('getNextLessonTopic', () => {
  it('returns first topic when lastTopic is null', () => {
    expect(getNextLessonTopic(null)).toBe('Selamlaşma');
  });

  it('returns the next topic in sequence', () => {
    expect(getNextLessonTopic('Selamlaşma')).toBe('Kendini tanıtma');
  });

  it('wraps around after last topic', () => {
    const last = A1_LESSON_PROGRESSION[A1_LESSON_PROGRESSION.length - 1];
    expect(getNextLessonTopic(last)).toBe('Selamlaşma');
  });

  it('returns first topic for unknown lastTopic', () => {
    expect(getNextLessonTopic('Bilinmeyen')).toBe('Selamlaşma');
  });
});
