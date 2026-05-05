import { SessionContext, ThoughtHookOutput } from '@/utils/ai/types';

export type { SessionContext };

function buildTeacherGuidance(hook: ThoughtHookOutput): string {
  const errorFocus = hook.error_spotted
    ? `\nERROR_FOCUS: ${hook.error_spotted} — bu hatayı bu turda ele al`
    : '';
  return `<teacher_guidance>
MODE: ${hook.mode}
TECHNIQUE: ${hook.technique}
DIFFICULTY: ${hook.difficulty_signal}${errorFocus}
NOTE: ${hook.teaching_note}
</teacher_guidance>`;
}

const TECHNIQUE_HINTS: Record<string, string> = {
  tr_to_de: 'Türkçe anlamı ver, Almancasını + artiklini iste.',
  de_to_tr: 'Almanca kelimeyi ver, Türkçe anlamını iste.',
  fill_blank: 'Kelimeyi içeren bir cümle yaz, kelimeyi ___ ile değiştir.',
  make_sentence: '"Bu kelimeyi kullanarak bir cümle kur" de.',
  free_chat: 'Bilinen kelimelerle 2-3 tur Almanca sohbet başlat. update_last_word_review ÇAĞIRMA.',
  error_correction: 'Önce hatayı nazikçe düzelt, sonra devam et.',
};

export function buildDeutschMeisterSystemPrompt(ctx: SessionContext): string {
  const basePrompt = `Sen DeutschMeister'sın — Türkçe konuşan A1 öğrencisine özel Almanca öğretmeni.

ARAÇLARIN:
- get_next_word: Sıradaki kelimeyi getir. Drill modunda NE ZAMAN çağıracağına sen karar ver.
- update_last_word_review: Drill sonrası öğrencinin cevabını puanla (1-4). Sohbet/cümle modunda ÇAĞIRMA.

ARTİKEL KURALI: 🔵 der Hund | 🔴 die Katze | 🟢 das Buch — artikelsiz asla yazma.
HATA DÜZELTMESİ: "✓ Güzel! Sadece: [doğrusu]"
Bilinen kelime: ${ctx.knownCount}/650`.trim();

  if (!ctx.thoughtHook) {
    // First message — no history to observe, start with a drill
    return basePrompt + `\n\n<teacher_guidance>
MODE: drill
TECHNIQUE: tr_to_de
DIFFICULTY: optimal
NOTE: İlk mesaj. get_next_word ile başla, sıcak bir karşılama yap.
</teacher_guidance>`;
  }

  const techniqueHint = TECHNIQUE_HINTS[ctx.thoughtHook.technique] ?? '';
  const guidance = buildTeacherGuidance(ctx.thoughtHook);
  return `${basePrompt}\n\nTEKNİK İPUCU (${ctx.thoughtHook.technique}): ${techniqueHint}\n\n${guidance}`;
}
