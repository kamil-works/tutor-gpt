import React from 'react';

const ARTICLE_REGEX = /(🔵 der|🔴 die|🟢 das)/g;

const ARTICLE_STYLE: Record<string, { bg: string }> = {
  '🔵 der': { bg: '#1e40af' },
  '🔴 die': { bg: '#b91c1c' },
  '🟢 das': { bg: '#15803d' },
};

const ARTICLE_LABEL: Record<string, string> = {
  '🔵 der': 'der',
  '🔴 die': 'die',
  '🟢 das': 'das',
};

export function renderArticles(text: string): React.ReactNode[] {
  return text.split(ARTICLE_REGEX).map((part, i) => {
    const style = ARTICLE_STYLE[part];
    if (style) {
      return (
        <span
          key={i}
          style={{
            background: style.bg,
            color: 'white',
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 4,
            fontSize: '0.85em',
            display: 'inline-block',
            marginRight: 2,
          }}
        >
          {ARTICLE_LABEL[part]}
        </span>
      );
    }
    return part;
  });
}

export function processArticlesForMarkdown(text: string): string {
  return text
    .replace(/🔵 der/g, '<span style="background:#1e40af;color:white;font-weight:700;padding:1px 6px;border-radius:4px;font-size:0.85em">der</span>')
    .replace(/🔴 die/g, '<span style="background:#b91c1c;color:white;font-weight:700;padding:1px 6px;border-radius:4px;font-size:0.85em">die</span>')
    .replace(/🟢 das/g, '<span style="background:#15803d;color:white;font-weight:700;padding:1px 6px;border-radius:4px;font-size:0.85em">das</span>');
}
