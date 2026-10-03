import { cn } from "@/lib/cn";

interface Props {
  done: boolean;
  onChange: () => void;
  size?: number;
}

/** 圆形打勾动画复选框 */
export function Checkbox({ done, onChange, size = 20 }: Props) {
  return (
    <button
      type="button"
      aria-label={done ? "标记为未完成" : "标记为完成"}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border-2 transition-all duration-150",
        done
          ? "checked border-accent bg-accent"
          : "border-ink3/50 hover:border-accent hover:shadow-[0_0_0_4px_var(--accent-soft)]",
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size - 8}
        height={size - 8}
        fill="none"
        aria-hidden
      >
        <path
          className="check-path"
          d="M5 12.5l4.5 4.5L19 7.5"
          stroke="#fff"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
