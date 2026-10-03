interface Props {
  emoji: string;
  title: string;
  hint?: string;
}

export function EmptyState({ emoji, title, hint }: Props) {
  return (
    <div className="fade-in flex flex-col items-center justify-center gap-1.5 py-16 text-center">
      <div className="relative mb-3 flex h-28 w-28 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-accent-soft" />
        <div className="absolute inset-3.5 rounded-full bg-panel2/80 backdrop-blur-sm" />
        <span className="relative text-4xl">{emoji}</span>
      </div>
      <div className="text-[15px] font-medium text-ink2">{title}</div>
      {hint && (
        <div className="max-w-64 text-[13px] leading-relaxed text-ink3">{hint}</div>
      )}
    </div>
  );
}
