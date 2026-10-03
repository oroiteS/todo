import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getMonthGrid, parseDate, todayStr } from "@/core/dates";
import { cn } from "@/lib/cn";
import { useClickOutside } from "./Dropdown";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);

/** 年份可选范围：过去定死 2000 年；未来到当前年份 +10（动态） */
const MIN_YEAR = 2000;
const MAX_YEAR = new Date().getFullYear() + 10;

function formatFull(dateStr: string): string {
  const d = parseDate(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

interface Props {
  /** "yyyy-MM-dd" 或 undefined */
  value?: string;
  onChange(value: string | undefined): void;
}

/** 定制深色日历：大尺寸面板 + 年月选择视图 + 清除/今天（参考中文日历习惯，周日开头） */
export function DatePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"date" | "panel">("date");
  const today = todayStr();

  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());

  const close = () => {
    setOpen(false);
    setMode("date");
  };
  const ref = useClickOutside(close);

  // 打开时视图对齐当前值（或今天）
  useEffect(() => {
    if (!open) return;
    const d = value ? parseDate(value) : new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setMode("date");
  }, [open, value]);

  const grid = useMemo(() => getMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  /** 年份列表：完整范围 2000 ~ 今年+10，可一路滑到底 */
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = MIN_YEAR; y <= MAX_YEAR; y++) list.push(y);
    return list;
  }, []);

  // 年月面板打开 / 切换年份时，把当前年份滚动到列表中央
  const yearListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== "panel") return;
    const container = yearListRef.current;
    const el = container?.querySelector<HTMLElement>(`[data-year="${viewYear}"]`);
    if (container && el) {
      container.scrollTop =
        el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    }
  }, [mode, viewYear]);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    const y = Math.min(MAX_YEAR, Math.max(MIN_YEAR, d.getFullYear()));
    setViewYear(y);
    setViewMonth(d.getMonth());
  };

  const shiftYear = (delta: number) =>
    setViewYear((y) => Math.min(MAX_YEAR, Math.max(MIN_YEAR, y + delta)));

  const pick = (date: string) => {
    onChange(date);
    close();
  };

  const label = `${viewYear}年${String(viewMonth + 1).padStart(2, "0")}月`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-lg border bg-bg px-2.5 text-[13px] transition-colors",
          open ? "border-accent/60" : "border-line hover:border-accent/40",
        )}
      >
        <CalendarDays size={14} className="shrink-0 text-ink3" />
        <span className={cn("flex-1 text-left", !value && "text-ink3")}>
          {value ? formatFull(value) : "选择日期"}
        </span>
        <ChevronDown
          size={13}
          className={cn("shrink-0 text-ink3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="选择日期"
          className="pop-in absolute right-0 z-50 mt-2 w-[268px] rounded-2xl border border-line bg-panel p-3 shadow-2xl shadow-black/40"
        >
          {mode === "date" ? (
            <>
              {/* 头部：年月（可点开年月选择）+ 前后翻月 */}
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setMode("panel")}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-ink transition-colors hover:bg-panel2"
                >
                  {label}
                  <ChevronDown size={12} className="text-ink3" />
                </button>
                <div className="flex items-center gap-0.5">
                  <NavButton label="上一月" onClick={() => shiftMonth(-1)}>
                    <ChevronLeft size={14} />
                  </NavButton>
                  <NavButton label="下一月" onClick={() => shiftMonth(1)}>
                    <ChevronRight size={14} />
                  </NavButton>
                </div>
              </div>

              {/* 星期表头（周日开头） */}
              <div className="mb-1 grid grid-cols-7">
                {WEEKDAYS.map((w) => (
                  <div
                    key={w}
                    className="flex h-7 items-center justify-center text-[11px] text-ink3"
                  >
                    {w}
                  </div>
                ))}
              </div>

              {/* 日期网格 */}
              <div className="grid grid-cols-7 gap-y-0.5">
                {grid.flat().map((cell) => {
                  const isSelected = cell.date === value;
                  const isToday = cell.date === today;
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      onClick={() => pick(cell.date)}
                      aria-label={cell.date}
                      className={cn(
                        "mx-auto flex h-9 w-9 items-center justify-center rounded-xl text-[13px] transition-colors",
                        !cell.inMonth && "text-ink3/45",
                        cell.inMonth && !isSelected && "text-ink hover:bg-panel2",
                        isSelected && "bg-accent font-semibold text-white shadow-sm",
                        !isSelected && isToday && "ring-1 ring-inset ring-accent/70",
                      )}
                    >
                      {parseDate(cell.date).getDate()}
                    </button>
                  );
                })}
              </div>

              {/* 底部操作 */}
              <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onChange(undefined);
                    close();
                  }}
                  className="rounded-lg px-2.5 py-1 text-xs text-accent/90 transition-colors hover:bg-accent-soft"
                >
                  清除
                </button>
                <button
                  type="button"
                  onClick={() => pick(today)}
                  className="rounded-lg px-2.5 py-1 text-xs text-accent/90 transition-colors hover:bg-accent-soft"
                >
                  今天
                </button>
              </div>
            </>
          ) : (
            <>
              {/* 年月选择视图 */}
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setMode("date")}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-ink transition-colors hover:bg-panel2"
                >
                  {label}
                  <ChevronDown size={12} className="rotate-180 text-ink3" />
                </button>
                <span className="pr-1 text-[11px] text-ink3">选择月份</span>
              </div>

              <div className="mb-1.5 flex items-center justify-between">
                <button
                  type="button"
                  aria-label="上一年"
                  onClick={() => shiftYear(-1)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="text-[13px] font-semibold text-ink">{viewYear}</span>
                <button
                  type="button"
                  aria-label="下一年"
                  onClick={() => shiftYear(1)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
                >
                  <ChevronRight size={13} />
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1">
                {MONTH_LABELS.map((m, i) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setViewMonth(i);
                      setMode("date");
                    }}
                    className={cn(
                      "flex h-9 items-center justify-center rounded-lg text-xs transition-colors",
                      i === viewMonth
                        ? "bg-accent font-semibold text-white shadow-sm"
                        : "text-ink2 hover:bg-panel2 hover:text-ink",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {/* 可滑动年份列表（2000 年起），当前年份自动居中 */}
              <div className="relative mt-2 border-t border-line/60 pt-1">
                <div ref={yearListRef} className="relative max-h-32 overflow-y-auto">
                  {years.map((y) => (
                    <button
                      key={y}
                      type="button"
                      data-year={y}
                      onClick={() => setViewYear(y)}
                      className={cn(
                        "flex w-full items-center justify-center rounded-lg py-1.5 text-[13px] transition-colors",
                        y === viewYear
                          ? "bg-panel2 font-semibold text-ink"
                          : "text-ink2 hover:bg-panel2/60 hover:text-ink",
                      )}
                    >
                      {y}
                    </button>
                  ))}
                </div>
                {/* 上下渐隐，提示可滑动 */}
                <div className="pointer-events-none absolute inset-x-0 top-1 h-4 bg-gradient-to-b from-panel to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-panel to-transparent" />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
    >
      {children}
    </button>
  );
}
