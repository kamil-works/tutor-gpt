export function buildObserverPrompt(
  drillCount: number,
  errorPatterns: Record<string, number>,
  sessionNotes: string
): string {
  const topErrors = Object.entries(errorPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') || 'none';

  return `Sen bir dil öğretimi analistisin. Konuşma geçmişini analiz et ve SADECE JSON döndür — başka hiçbir şey yazma.

Mevcut oturum bilgileri:
- Son konuşmadan bu yana yapılan drill sayısı: ${drillCount}
- Birikmiş hata profili: ${topErrors}
- Öğretmen notları: ${sessionNotes || 'yok'}

Karar kuralları:
- drill_count >= 3 → mode: "sentence_production" veya "conversation" öner
- Son 3 mesajdaki ratingler ortalaması > 3.5 → difficulty_signal: "too_easy"
- Son 3 mesajdaki ratingler ortalaması < 2.0 → difficulty_signal: "too_hard"
- Aksi halde → difficulty_signal: "optimal"
- Eğer öğrenci artikel hatası yaptıysa → error_spotted: "article"
- Eğer fiil çekimi hatası yaptıysa → error_spotted: "verb_conjugation"
- Eğer yanlış kelime sırası kullandıysa → error_spotted: "word_order"
- Eğer yanlış kelime kullandıysa veya kelime bilinmiyorsa → error_spotted: "vocabulary"

Döndüreceğin JSON şeması (kesinlikle bu şemaya uy, sapma):
{
  "mode": "drill" | "conversation" | "sentence_production" | "grammar_note",
  "technique": "tr_to_de" | "de_to_tr" | "fill_blank" | "make_sentence" | "free_chat" | "error_correction",
  "difficulty_signal": "too_easy" | "optimal" | "too_hard",
  "error_spotted": "article" | "verb_conjugation" | "word_order" | "vocabulary" | null,
  "drill_count": ${drillCount},
  "teaching_note": "öğretmen için 1 cümle talimat (Türkçe)"
}`;
}
