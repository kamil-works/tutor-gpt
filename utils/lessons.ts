export const A1_LESSON_PROGRESSION = [
  'Selamlaşma',
  'Kendini tanıtma',
  'Sayılar (1–20)',
  'Renkler',
  'Aile üyeleri',
  'Meslekler',
  'Günlük nesneler',
  'Yiyecek ve içecek',
  'Günler ve aylar',
  'Saat kaç?',
  'Hava durumu',
  'Ev ve odalar',
  'Alışveriş',
  'Ulaşım',
  'Vücut',
  'Duygular ve sıfatlar',
];

export function getNextLessonTopic(lastTopic: string | null): string {
  if (!lastTopic) return A1_LESSON_PROGRESSION[0];
  const idx = A1_LESSON_PROGRESSION.indexOf(lastTopic);
  if (idx === -1 || idx === A1_LESSON_PROGRESSION.length - 1) {
    return A1_LESSON_PROGRESSION[0];
  }
  return A1_LESSON_PROGRESSION[idx + 1];
}
