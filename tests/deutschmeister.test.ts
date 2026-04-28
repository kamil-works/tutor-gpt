import { describe, it, expect } from 'vitest';
import { buildDeutschMeisterSystemPrompt, type SessionContext } from '@/utils/prompts/deutschmeister';
import { getNextLessonTopic, A1_LESSON_PROGRESSION } from '@/utils/lessons';
import { renderArticles } from '@/components/ArticleRenderer';

describe('buildDeutschMeisterSystemPrompt', () => {
  const ctx: SessionContext = {
    lessonTopic: 'Selamlaşma',
    lastTopic: null,
    knownCount: 0,
    dueCount: 5,
    anxietySignal: 'medium',
  };

  it('includes the tool loop instructions', () => {
    const prompt = buildDeutschMeisterSystemPrompt(ctx);
    expect(prompt).toContain('get_next_word');
    expect(prompt).toContain('update_last_word_review');
  });

  it('includes the article color system', () => {
    const prompt = buildDeutschMeisterSystemPrompt(ctx);
    expect(prompt).toContain('🔵 der');
    expect(prompt).toContain('🔴 die');
    expect(prompt).toContain('🟢 das');
  });

  it('injects session context', () => {
    const prompt = buildDeutschMeisterSystemPrompt(ctx);
    expect(prompt).toContain('0/650');
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

describe('renderArticles', () => {
  it('replaces 🔵 der with a blue badge', () => {
    const result = renderArticles('Das ist 🔵 der Hund.');
    const str = JSON.stringify(result);
    expect(str).toContain('der');
    expect(str).toContain('#1e40af');
  });

  it('replaces 🔴 die with a red badge', () => {
    const result = renderArticles('Das ist 🔴 die Katze.');
    expect(JSON.stringify(result)).toContain('#b91c1c');
  });

  it('replaces 🟢 das with a green badge', () => {
    const result = renderArticles('Das ist 🟢 das Buch.');
    expect(JSON.stringify(result)).toContain('#15803d');
  });

  it('leaves plain text unchanged', () => {
    const result = renderArticles('Kein Artikel hier.');
    expect(result).toEqual(['Kein Artikel hier.']);
  });
});
