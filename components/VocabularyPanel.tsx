'use client';

import { useEffect, useState } from 'react';

interface VocabCard {
  card_id: string;
  word: string;
  article: string;
  translation_tr: string;
  status: string;
}

interface PanelData {
  dueWords: VocabCard[];
  knownCount: number;
  totalCount: number;
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-gray-100 dark:bg-gray-800',
  seen: 'bg-blue-50 dark:bg-blue-900/20',
  struggling: 'bg-red-50 dark:bg-red-900/20',
  known: 'bg-green-50 dark:bg-green-900/20',
};

export default function VocabularyPanel() {
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/vocabulary/due')
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Kelimeler yükleniyor...</div>
    );
  }

  if (!data) return null;

  const progressPct = data.totalCount > 0
    ? Math.round((data.knownCount / data.totalCount) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b">
        <h3 className="font-semibold text-sm mb-1">Kelime İlerlemesi</h3>
        <div className="text-xs text-muted-foreground mb-2">
          {data.knownCount} / {data.totalCount} ({progressPct}%)
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
          <div
            className="bg-green-500 h-1.5 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
          Bugün Tekrar ({data.dueWords.length})
        </h4>
        {data.dueWords.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bugün tekrar edilecek kelime yok 🎉</p>
        ) : (
          data.dueWords.map((card) => (
            <div
              key={card.card_id}
              className={`mb-2 p-2 rounded-lg text-sm ${STATUS_COLORS[card.status] ?? ''}`}
            >
              <span className="font-medium">
                {card.article !== '—' ? `${card.article} ` : ''}
                {card.word}
              </span>
              <span className="text-muted-foreground ml-2 text-xs">{card.translation_tr}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
