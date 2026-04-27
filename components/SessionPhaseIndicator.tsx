'use client';

type Phase = 'warmup' | 'lesson' | 'conversation' | null;

interface SessionPhaseIndicatorProps {
  phase: Phase;
  lessonTopic?: string;
}

const PHASES: { id: Phase; label: string }[] = [
  { id: 'warmup', label: '🔥 Isıtma' },
  { id: 'lesson', label: '📚 Ders' },
  { id: 'conversation', label: '💬 Pratik' },
];

export default function SessionPhaseIndicator({ phase, lessonTopic }: SessionPhaseIndicatorProps) {
  if (!phase) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1 text-xs border-b border-border">
      {PHASES.map((p, i) => (
        <span key={p.id} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground">→</span>}
          <span className={phase === p.id ? 'font-semibold text-blue-500' : 'text-muted-foreground'}>
            {p.label}
          </span>
        </span>
      ))}
      {lessonTopic && (
        <span className="ml-2 text-muted-foreground">· {lessonTopic}</span>
      )}
    </div>
  );
}
