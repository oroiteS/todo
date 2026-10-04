import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface ContextMenuItem {
  icon?: ReactNode;
  label: string;
  danger?: boolean;
  onClick(): void;
}

/** 右键（移动端长按）上下文菜单：出现在光标处，自动防出屏；
 *  点击外部 / Esc / 点任意项 后关闭。 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // 防出屏：右边和下边留出菜单本身的尺寸
  const left = Math.min(x, window.innerWidth - 176);
  const top = Math.min(y, window.innerHeight - items.length * 34 - 16);

  return (
    <div ref={ref} className="fixed z-[70]" style={{ left, top }}>
      <div
        className="pop-in min-w-40 rounded-xl border border-line bg-panel p-1 shadow-xl shadow-black/10"
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            onClick={() => {
              onClose();
              it.onClick();
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
              it.danger ? "text-danger hover:bg-danger/10" : "text-ink hover:bg-panel2",
            )}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
