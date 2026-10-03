interface Props {
  emoji: string;
  title: string;
  hint?: string;
}

export function EmptyState({ emoji, title, hint }: Props) {
  return (
    <div className="fade-in flex flex-col items-center justify-center gap-1.5 py-20 text-center">
      <div className="text-5xl">{emoji}</div>
      <div className="mt-2 text-[15px] font-medium text-ink2">{title}</div>
      {hint && (
        <div className="max-w-64 text-[13px] leading-relaxed text-ink3">{hint}</div>
      )}
    </div>
  );
}
