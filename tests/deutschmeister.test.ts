import { describe, it, expect } from 'vitest';
import { buildDeutschMeisterSystemPrompt } from '@/utils/prompts/deutschmeister';
import { SessionContext } from '@/utils/ai/types';
import { getNextLessonTopic, A1_LESSON_PROGRESSION } from '@/utils/lessons';
import { renderArticles } from '@/components/ArticleRenderer';

const ctx: SessionContext = {
  lessonTopic: 'Test Topic',
  lastTopic: null,
  knownCount: 0,
  dueCount: 5,
  anxietySignal: 'medium',
};

describe('buildDeutschMeisterSystemPrompt', () => {
  it('injects session context', () => {
    const prompt = buildDeutschMeisterSystemPrompt(ctx);
    expect(prompt).toContain('0/650');
  });

  it('includes article rule', () => {
    const prompt = buildDeutschMeisterSystemPrompt(ctx);
    expect(prompt).toContain('🔵');
    expect(prompt).toContain('🔴');
    expect(prompt).toContain('🟢');
  });

  it('includes teacher_guidance block when thoughtHook provided', () => {
    const ctxWithHook: SessionContext = {
      ...ctx,
      thoughtHook: {
        mode: 'conversation',
        technique: 'free_chat',
        difficulty_signal: 'optimal',
        error_spotted: null,
        drill_count: 3,
        teaching_note: 'Sohbet aç.',
      },
    };
    const prompt = buildDeutschMeisterSystemPrompt(ctxWithHook);
    expect(prompt).toContain('<teacher_guidance>');
    expect(prompt).toContain('MODE: conversation');
    expect(prompt).toContain('TECHNIQUE: free_chat');
  });

  it('uses default drill guidance when thoughtHook is undefined', () => {
    const prompt = buildDeutschMeisterSystemPrompt(ctx); // ctx has no thoughtHook
    expect(prompt).toContain('MODE: drill');
    expect(prompt).toContain('İlk mesaj');
  });

  it('includes error focus when error_spotted is set', () => {
    const ctxWithError: SessionContext = {
      ...ctx,
      thoughtHook: {
        mode: 'drill',
        technique: 'fill_blank',
        difficulty_signal: 'optimal',
        error_spotted: 'article',
        drill_count: 1,
        teaching_note: 'Article hatası var.',
      },
    };
    const prompt = buildDeutschMeisterSystemPrompt(ctxWithError);
    expect(prompt).toContain('ERROR_FOCUS: article');
  });

  it('includes technique hint when thoughtHook provided', () => {
    const ctxWithHook: SessionContext = {
      ...ctx,
      thoughtHook: {
        mode: 'drill',
        technique: 'tr_to_de',
        difficulty_signal: 'optimal',
        error_spotted: null,
        drill_count: 0,
        teaching_note: 'Kelime çalış.',
      },
    };
    const prompt = buildDeutschMeisterSystemPrompt(ctxWithHook);
    expect(prompt).toContain('TEKNİK İPUCU');
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
