import { createPortal } from "react-dom";
import {
  FolderOpen,
  X,
  FileText,
  Eye,
  Trash2,
  Loader2,
  Play,
  CheckCircle2,
  Clock,
  Download,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import type { ReviewHistoryItem, ReviewJobStatus } from "@/app/api/endpoints/review";
import { Button } from "@/app/components/ui/button";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { cn } from "@/app/components/ui/utils";

interface ReviewedHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  records: ReviewHistoryItem[];
  loading?: boolean;
  onContinue?: (record: ReviewHistoryItem) => void;
  onDelete?: (record: ReviewHistoryItem) => void;
  onDownloadDocx?: (record: ReviewHistoryItem) => void;
}

function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), "dd/MM/yyyy HH:mm");
  } catch {
    return iso;
  }
}

const STATUS_CONFIG: Record<
  ReviewJobStatus,
  { labelKey: string; icon: typeof Clock; cls: string; badgeCls: string }
> = {
  draft: {
    labelKey: "review.myDocs.statusDraft",
    icon: FileText,
    cls: "border-gray-200 bg-gray-50 text-gray-500",
    badgeCls: "border-gray-200 bg-gray-50 text-gray-500",
  },
  reviewing: {
    labelKey: "review.myDocs.statusReviewing",
    icon: Clock,
    cls: "border-blue-200 bg-blue-50 text-blue-700",
    badgeCls: "border-blue-200 bg-blue-50 text-blue-700",
  },
  completed: {
    labelKey: "review.myDocs.statusCompleted",
    icon: CheckCircle2,
    cls: "border-emerald-200 bg-emerald-50 text-emerald-700",
    badgeCls: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
};

export function ReviewedHistoryDrawer({
  open,
  onClose,
  records,
  loading,
  onContinue,
  onDelete,
  onDownloadDocx,
}: ReviewedHistoryDrawerProps) {
  const { t } = useTranslation();
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className="bg-background border-border relative ml-auto flex h-full w-[520px] max-w-full flex-col border-l shadow-2xl"
        style={{ animation: "doc-review-slide-in-right 0.22s ease" }}
      >
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="bg-brand-50 flex h-8 w-8 items-center justify-center rounded-lg">
              <FolderOpen className="text-brand-600 h-4 w-4" />
            </div>
            <div>
              <h2 className="text-foreground text-sm font-semibold">
                {t("review.myDocs.drawerTitle")}
              </h2>
              <p className="text-muted-foreground text-xs">
                {t("review.myDocs.documentCount", { count: records.length })}
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

        {/* List */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-2.5 p-4">
            {loading && (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-xs">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("review.myDocs.loading")}
              </div>
            )}
            {!loading && records.length === 0 && (
              <div className="text-muted-foreground py-10 text-center text-xs">
                {t("review.myDocs.noDocuments")}
              </div>
            )}
            {records.map((rec) => {
              // const _riskStyle = getRiskStyle(rec.risk_score ?? 0); void _riskStyle;
              const statusCfg = STATUS_CONFIG[rec.status] ?? STATUS_CONFIG.reviewing;
              const StatusIcon = statusCfg.icon;
              const isCompleted = rec.status === "completed";
              const isDraftOrReviewing = rec.status === "draft" || rec.status === "reviewing";

              return (
                <div
                  key={rec.id}
                  className="border-border bg-card rounded-xl border p-4 transition-all hover:shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="bg-muted mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg">
                      <FileText className="text-muted-foreground h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* Title + status badge */}
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-foreground min-w-0 truncate text-sm font-medium">
                          {rec.document_name}
                        </p>
                        <span
                          className={cn(
                            "flex flex-shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                            statusCfg.badgeCls
                          )}
                        >
                          <StatusIcon className="h-2.5 w-2.5" />
                          {t(statusCfg.labelKey as never)}
                        </span>
                      </div>

                      {/* Meta row */}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="text-muted-foreground text-[10px]">
                          {rec.review_type} Review
                        </span>
                        {/* {rec.compare_mode && (
                          <>
                            <span className="text-muted-foreground/40 text-[10px]">•</span>
                            <span
                              className={cn(
                                "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                                rec.compare_mode === "tracked"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-violet-200 bg-violet-50 text-violet-700"
                              )}
                            >
                              {rec.compare_mode === "tracked" ? t("review.myDocs.compareTracked") : t("review.myDocs.compareSemantic")}
                            </span>
                          </>
                        )} */}
                        <span className="text-muted-foreground/40 text-[10px]">•</span>
                        <span className="text-muted-foreground text-[10px]">
                          {formatDate(rec.created_at)}
                        </span>
                        {/* {rec.risk_score != null && (
                          <>
                            <span className="text-muted-foreground/40 text-[10px]">•</span>
                            <span
                              className={cn(
                                "rounded-full border px-1.5 py-0.5 text-[10px] font-bold",
                                riskStyle.badge
                              )}
                            >
                              {t("review.myDocs.riskLabel", { score: rec.risk_score })}
                            </span>
                          </>
                        )} */}
                      </div>

                      <div className="border-border/60 mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
                        {isDraftOrReviewing ? (
                          <>
                            {/* Nháp / Đang review: Tiếp tục + Xóa */}
                            <Button
                              variant="default"
                              size="sm"
                              className="bg-brand-500 hover:bg-brand-600 h-7 flex-1 gap-1.5 text-[11px] text-white"
                              onClick={() => onContinue?.(rec)}
                            >
                              <Play className="h-3 w-3 fill-white" />
                              {t("review.myDocs.actionContinue")}
                            </Button>
                          </>
                        ) : isCompleted ? (
                          <>
                            {/* Hoàn tất: Mở kết quả + Tải file final + Xóa */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 flex-1 gap-1.5 text-[11px]"
                              onClick={() => onContinue?.(rec)}
                            >
                              <Eye className="h-3 w-3" />
                              {t("review.myDocs.actionOpenResult")}
                            </Button>
                            {onDownloadDocx && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1.5 text-[11px]"
                                onClick={() => onDownloadDocx(rec)}
                              >
                                <Download className="h-3 w-3" />
                                {t("review.myDocs.downloadDocx")}
                              </Button>
                            )}
                          </>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5 text-[11px]"
                          onClick={() => onDelete?.(rec)}
                        >
                          <Trash2 className="h-3 w-3 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>,
    document.body
  );
}
