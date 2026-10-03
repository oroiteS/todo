import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useCallback(onOutside, [onOutside]);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [cb]);
  return ref;
}

interface DropdownProps {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  panelClass?: string;
}

/** 轻量下拉弹出层 */
export function Dropdown({ trigger, children, align = "right", panelClass }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(close);
  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={cn(
            "pop-in absolute z-50 mt-1.5 min-w-40 rounded-xl border border-line bg-panel p-1 shadow-xl shadow-black/10",
            align === "right" ? "right-0" : "left-0",
            panelClass,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon?: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

export function MenuItem({ icon, label, danger, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
        danger
          ? "text-danger hover:bg-danger/10"
          : "text-ink hover:bg-panel2",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
