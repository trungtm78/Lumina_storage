import { createPortal } from "react-dom";
import {
  X,
  FileText,
  ScanText,
  RotateCcw,
  Check,
  Wand2,
  History,
  Clock,
  GitBranch,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { cn } from "@/app/components/ui/utils";

export type SessionEventType =
  | "file_selected"
  | "ai_scan"
  | "review_start"
  | "review_done"
  | "fix_applied"
  | "quick_action"
  | "version_saved"
  | "restored";

export interface SessionEvent {
  id: string;
  type: SessionEventType;
  label: string;
  timestamp: Date;
}

interface ProgressHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  events: SessionEvent[];
}

const EVENT_ICON: Record<SessionEventType, typeof FileText> = {
  file_selected: FileText,
  ai_scan: ScanText,
  review_start: RotateCcw,
  review_done: Check,
  fix_applied: Check,
  quick_action: Wand2,
  version_saved: GitBranch,
  restored: History,
};

const EVENT_COLOR: Record<SessionEventType, string> = {
  file_selected: "bg-blue-100 text-blue-600",
  ai_scan: "bg-violet-100 text-violet-600",
  review_start: "bg-amber-100 text-amber-600",
  review_done: "bg-emerald-100 text-emerald-600",
  fix_applied: "bg-emerald-100 text-emerald-600",
  quick_action: "bg-brand-100 text-brand-600",
  version_saved: "bg-primary/10 text-primary",
  restored: "bg-slate-100 text-slate-600",
};

function formatTime(d: Date, locale: string): string {
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function ProgressHistoryDrawer({
  open,
  onClose,
  events,
}: ProgressHistoryDrawerProps) {
  const { t, i18n } = useTranslation();
  if (!open) return null;

  // Đảo ngược mảng events để sự kiện mới nhất lên đầu
  const reversedEvents = [...events].reverse();

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className="bg-background border-border relative ml-auto flex h-full w-[420px] max-w-full flex-col border-l shadow-2xl"
        style={{ animation: "doc-review-slide-in-right 0.22s ease" }}
      >
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="bg-brand-50 flex h-8 w-8 items-center justify-center rounded-lg">
              <Clock className="text-brand-600 h-4 w-4" />
            </div>
            <div>
              <h2 className="text-foreground text-sm font-semibold">
                {t("review.progress.drawerTitle")}
              </h2>
              <p className="text-muted-foreground text-xs">
                {t("review.progress.eventCount", { count: events.length })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-muted flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
          >
            <X className="text-muted-foreground h-4 w-4" />
          </button>
        </div>

        {/* Timeline */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4">
            {events.length === 0 && (
              <div className="text-muted-foreground py-10 text-center text-xs">
                {t("review.progress.noEvents")}
              </div>
            )}
            {events.length > 0 && (
              <ol className="relative space-y-0">
                {/* Thay events bằng reversedEvents */}
                {reversedEvents.map((ev, idx) => {
                  const Icon = EVENT_ICON[ev.type];
                  const colorCls = EVENT_COLOR[ev.type];
                  // Logic isLast vẫn đúng vì áp dụng trên mảng đã đảo ngược
                  const isLast = idx === reversedEvents.length - 1;
                  return (
                    <li key={ev.id} className="flex gap-3">
                      {/* Timeline spine */}
                      <div className="flex flex-col items-center">
                        <div className={cn("flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full", colorCls)}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        {!isLast && (
                          <div className="bg-border/60 mt-1 w-px flex-1" style={{ minHeight: 16 }} />
                        )}
                      </div>
                      {/* Content */}
                      <div className={cn("min-w-0 flex-1 pb-4", isLast && "pb-0")}>
                        <p className="text-foreground text-[13px] font-medium leading-snug">
                          {ev.label}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-[11px]">
                          {formatTime(ev.timestamp, i18n.language)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>,
    document.body
  );
}