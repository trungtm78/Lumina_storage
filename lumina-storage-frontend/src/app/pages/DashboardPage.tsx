import { useState } from "react";
import {
  HardDrive,
  Share2,
  FileText,
  Activity,
  Download,
  Clock,
  ArrowRight,
  Loader2,
  CircleCheck,
  Users,
  FilePen,
  FileDown,
  Table2,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/app/components/ui/utils";
import { type LucideIcon } from "lucide-react";
import {
  useDashboardStats,
  useDashboardRecentFiles,
  useDashboardProcessingData,
  useDashboardSharedFiles,
} from "@/app/hooks/useDashboard";
import { format } from "date-fns";
import { toast } from "sonner";
import { dashboardApi } from "@/app/api/endpoints/dashboard";
import { documentsApi } from "@/app/api/endpoints/documents";
import { DocumentPreviewModal } from "@/app/components/document/DocumentPreviewModal";
import type { Document } from "@/app/types/document";
import { formatFileSize, bytesToGB, relativeTime } from "@/app/utils/formatters";

const processingStatusStyle: Record<string, string> = {
  running: "bg-amber-50 text-amber-600 border border-amber-200",
  pending: "bg-gray-100 text-gray-500 border border-gray-200",
  success: "bg-green-50 text-green-600 border border-green-200",
  failure: "bg-red-50 text-red-500 border border-red-200",
  revoked: "bg-gray-100 text-gray-400 border border-gray-200",
};

const fileTypeBadgeStyle: Record<string, string> = {
  docx: "bg-blue-50 text-blue-600",
  doc: "bg-blue-50 text-blue-600",
  pdf: "bg-red-50 text-red-500",
  xlsx: "bg-green-50 text-green-600",
  xls: "bg-green-50 text-green-600",
  csv: "bg-green-50 text-green-600",
  pptx: "bg-orange-50 text-orange-500",
  ppt: "bg-orange-50 text-orange-500",
};

function getFileIcon(ext: string): LucideIcon {
  const e = ext.toLowerCase().replace(/^\./, "");
  if (e === "xlsx" || e === "xls" || e === "csv") return Table2;
  if (e === "pdf") return FileDown;
  return FilePen;
}

function FileTypeIcon({ ext }: { ext: string }) {
  const Icon = getFileIcon(ext);
  return (
    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/8">
      <Icon className="h-3.5 w-3.5 text-primary" />
    </div>
  );
}

function SkeletonLine({ className }: { className?: string }) {
  return <span className={cn("block animate-pulse rounded bg-muted", className)} />;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const statsQuery = useDashboardStats();
  const recentQuery = useDashboardRecentFiles();
  const processingQuery = useDashboardProcessingData();
  const sharedQuery = useDashboardSharedFiles();

  const processingStatusLabel: Record<string, string> = {
    running: t("dashboard.processing.statusProcessing"),
    pending: t("dashboard.processing.statusQueued"),
    success: t("dashboard.processing.statusCompleted"),
    failure: t("dashboard.processing.statusFailed"),
    revoked: t("dashboard.processing.statusRevoked"),
  };

  const [isDownloading, setIsDownloading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  async function handleOpenDoc(documentId: string) {
    try {
      const doc = await documentsApi.get(documentId);
      setPreviewDoc(doc);
      setPreviewOpen(true);
    } catch {
      toast.error(t("dashboard.openDocError"));
    }
  }

  async function handleOpenProcessingDoc(documentId: string | null, status: string) {
    if (!documentId) return;
    if (status === "running" || status === "pending") {
      toast.info(t("dashboard.docStillProcessing"));
      return;
    }
    await handleOpenDoc(documentId);
  }

  async function handleDownloadReport() {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const blob = await dashboardApi.downloadReport();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lumina_dashboard_${format(new Date(), "yyyyMMdd")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("dashboard.reportError"));
    } finally {
      setIsDownloading(false);
    }
  }

  const stats = statsQuery.data;
  const isStatsLoading = statsQuery.isLoading;

  const storageTotalGB = stats?.storage.max_gb ?? 100;
  const storageUsedGB = stats ? bytesToGB(stats.storage.used_bytes) : 0;
  const storagePercent = Math.min(100, Math.round((storageUsedGB / storageTotalGB) * 100));

  const totalBreakdownBytes = stats?.storage.used_bytes ?? 0;
  const breakdownItems = stats
    ? [
        {
          label: t("dashboard.storage.documents"),
          value: formatFileSize(stats.storage.breakdown.documents_bytes),
          dot: "bg-blue-400",
          bar: "bg-blue-400",
          pct: totalBreakdownBytes > 0
            ? Math.round((stats.storage.breakdown.documents_bytes / totalBreakdownBytes) * 100)
            : 0,
        },
        {
          label: t("dashboard.storage.spreadsheets"),
          value: formatFileSize(stats.storage.breakdown.spreadsheets_bytes),
          dot: "bg-green-400",
          bar: "bg-green-400",
          pct: totalBreakdownBytes > 0
            ? Math.round((stats.storage.breakdown.spreadsheets_bytes / totalBreakdownBytes) * 100)
            : 0,
        },
        {
          label: t("dashboard.storage.presentations"),
          value: formatFileSize(stats.storage.breakdown.presentations_bytes),
          dot: "bg-orange-400",
          bar: "bg-orange-400",
          pct: totalBreakdownBytes > 0
            ? Math.round((stats.storage.breakdown.presentations_bytes / totalBreakdownBytes) * 100)
            : 0,
        },
        {
          label: t("dashboard.storage.other"),
          value: formatFileSize(stats.storage.breakdown.other_bytes),
          dot: "bg-purple-400",
          bar: "bg-purple-400",
          pct: totalBreakdownBytes > 0
            ? Math.round((stats.storage.breakdown.other_bytes / totalBreakdownBytes) * 100)
            : 0,
        },
      ]
    : null;

  return (
    <div className="min-h-full flex-1 overflow-y-auto bg-muted/20 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t("dashboard.title")}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("dashboard.subtitle")}
            </p>
          </div>
          <button
            onClick={handleDownloadReport}
            disabled={isDownloading}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isDownloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {isDownloading ? t("dashboard.reportGenerating") : t("dashboard.downloadReport")}
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {/* Storage Used */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground">{t("dashboard.stats.storageUsed")}</p>
                {isStatsLoading ? (
                  <SkeletonLine className="mt-1 h-7 w-24" />
                ) : (
                  <p className="mt-0.5 text-2xl font-bold text-foreground">
                    {storageUsedGB.toFixed(1)} GB
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">{t("dashboard.stats.ofTotal", { total: storageTotalGB })}</p>
              </div>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50">
                <HardDrive className="h-4 w-4 text-blue-500" />
              </div>
            </div>
            <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-blue-400 transition-all"
                style={{ width: `${storagePercent}%` }}
              />
            </div>
            <div className="mt-1 flex items-center gap-1">
              <CircleCheck className="h-2.5 w-2.5 text-green-500" />
              <span className="text-[10px] font-medium text-green-500">{t("dashboard.stats.statusNormal")}</span>
            </div>
          </div>

          {/* Processing Files */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground">{t("dashboard.stats.processingFiles")}</p>
                {isStatsLoading ? (
                  <SkeletonLine className="mt-1 h-7 w-12" />
                ) : (
                  <p className="mt-0.5 text-2xl font-bold text-foreground">
                    {stats!.processing.total}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">{t("dashboard.stats.inProgress")}</p>
              </div>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-amber-50">
                <Loader2 className="h-4 w-4 text-amber-500" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {isStatsLoading ? (
                <SkeletonLine className="h-3 w-32" />
              ) : (
                <>
                  <span className="text-[10px] text-muted-foreground">
                    {stats!.processing.processing} {t("dashboard.processing.statusProcessing")}
                  </span>
                  <span className="text-[10px] text-green-600">
                    {stats!.processing.completed} {t("dashboard.processing.statusCompleted")}
                  </span>
                  <span className="text-[10px] font-semibold text-red-500">
                    {stats!.processing.failed} {t("dashboard.processing.statusFailed")}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Shared Files */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground">{t("dashboard.stats.sharedFiles")}</p>
                {isStatsLoading ? (
                  <SkeletonLine className="mt-1 h-7 w-12" />
                ) : (
                  <p className="mt-0.5 text-2xl font-bold text-foreground">
                    {stats!.shared.total}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">{t("dashboard.stats.totalShared")}</p>
              </div>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-purple-50">
                <Share2 className="h-4 w-4 text-purple-500" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {isStatsLoading ? (
                <SkeletonLine className="h-3 w-28" />
              ) : (
                <>
                  <span className="text-[10px] text-muted-foreground">
                    {t("dashboard.stats.byYou", { count: stats!.shared.shared_by_me })}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("dashboard.stats.withYou", { count: stats!.shared.shared_with_me })}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Total Documents */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground">{t("dashboard.stats.totalDocuments")}</p>
                {isStatsLoading ? (
                  <SkeletonLine className="mt-1 h-7 w-16" />
                ) : (
                  <p className="mt-0.5 text-2xl font-bold text-foreground">
                    {stats!.documents.total.toLocaleString()}
                  </p>
                )}
                {isStatsLoading ? (
                  <SkeletonLine className="mt-0.5 h-3 w-20" />
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    {t("dashboard.stats.addedThisMonth", { count: stats!.documents.added_this_month })}
                  </p>
                )}
              </div>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/8">
                <FileText className="h-4 w-4 text-primary" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {isStatsLoading ? (
                <SkeletonLine className="h-3 w-28" />
              ) : (
                <>
                  <span className="text-[10px] text-muted-foreground">
                    {t("dashboard.stats.addedToday", { count: stats!.documents.added_today })}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("dashboard.stats.addedThisWeek", { count: stats!.documents.added_this_week })}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* My Activity */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground">{t("dashboard.stats.myActivity")}</p>
                {isStatsLoading ? (
                  <SkeletonLine className="mt-1 h-7 w-12" />
                ) : (
                  <p className="mt-0.5 text-2xl font-bold text-foreground">
                    {stats!.activity.total_today}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">{t("dashboard.stats.actionsToday")}</p>
              </div>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50">
                <Activity className="h-4 w-4 text-indigo-500" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {isStatsLoading ? (
                <SkeletonLine className="h-3 w-36" />
              ) : (
                <>
                  <span className="text-[10px] text-muted-foreground">
                    {t("dashboard.stats.uploaded")}{" "}
                    <strong className="font-semibold text-foreground">
                      {stats!.activity.uploaded_today}
                    </strong>
                  </span>
                  <span className="text-[10px] text-muted-foreground">•</span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("dashboard.stats.viewed")}{" "}
                    <strong className="font-semibold text-foreground">
                      {stats!.activity.viewed_today}
                    </strong>
                  </span>
                  <span className="text-[10px] text-muted-foreground">•</span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("dashboard.stats.shared")}{" "}
                    <strong className="font-semibold text-foreground">
                      {stats!.activity.shared_today}
                    </strong>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Storage Usage */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">{t("dashboard.storage.title")}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t("dashboard.storage.subtitle", { used: storageUsedGB.toFixed(1), total: storageTotalGB })}
              </p>
            </div>
            <span className="text-xs font-semibold text-blue-500">{storagePercent}%</span>
          </div>

          <div className="mb-4 h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-3 rounded-full bg-gradient-to-r from-blue-400 to-blue-500 transition-all"
              style={{ width: `${storagePercent}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {isStatsLoading || !breakdownItems
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <SkeletonLine className="h-3 w-20" />
                    <SkeletonLine className="h-4 w-16" />
                    <SkeletonLine className="h-1 w-full" />
                  </div>
                ))
              : breakdownItems.map(({ label, value, dot, bar, pct }) => (
                  <div key={label} className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className={cn("h-2 w-2 rounded-full", dot)} />
                      <span className="text-[10px] text-muted-foreground">{label}</span>
                    </div>
                    <p className="text-xs font-semibold text-foreground">{value}</p>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-1 rounded-full", bar)} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                ))}
          </div>
        </div>

        {/* Processing Data + Recent Files */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Processing Data */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">{t("dashboard.processing.title")}</p>
              </div>
              <button
                onClick={() => navigate("/tasks")}
                className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-primary"
              >
                {t("dashboard.processing.viewAll")} <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/30">
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("dashboard.processing.colFileName")}
                    </th>
                    <th className="hidden px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:table-cell">
                      {t("dashboard.processing.colType")}
                    </th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("dashboard.processing.colStatus")}
                    </th>
                    <th className="hidden px-5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:table-cell">
                      {t("dashboard.processing.colTime")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {processingQuery.isLoading
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/30 last:border-0">
                          <td className="px-5 py-3">
                            <SkeletonLine className="h-3 w-36" />
                          </td>
                          <td className="hidden px-3 py-3 sm:table-cell">
                            <SkeletonLine className="h-3 w-16" />
                          </td>
                          <td className="px-3 py-3">
                            <SkeletonLine className="h-5 w-16 rounded-md" />
                          </td>
                          <td className="hidden px-5 py-3 sm:table-cell">
                            <SkeletonLine className="ml-auto h-3 w-10" />
                          </td>
                        </tr>
                      ))
                    : (processingQuery.data ?? []).map((row) => (
                        <tr
                          key={row.id}
                          onClick={() => handleOpenProcessingDoc(row.document_id, row.status)}
                          className="group cursor-pointer border-b border-border/30 transition-colors last:border-0 hover:bg-muted/30"
                        >
                          <td className="px-5 py-3">
                            <span className="block max-w-[160px] truncate text-xs font-medium text-foreground transition-colors group-hover:text-primary">
                              {row.file_name}
                            </span>
                          </td>
                          <td className="hidden px-3 py-3 sm:table-cell">
                            <span className="text-[10px] text-muted-foreground">
                              {row.extension.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={cn(
                                "inline-block rounded-md px-2 py-0.5 text-[9px] font-semibold",
                                processingStatusStyle[row.status] ??
                                  "bg-gray-100 text-gray-500 border border-gray-200"
                              )}
                            >
                              {processingStatusLabel[row.status] ?? row.status}
                            </span>
                          </td>
                          <td className="hidden px-5 py-3 text-right sm:table-cell">
                            <span className="text-[10px] text-muted-foreground">
                              {relativeTime(row.created_at)}
                            </span>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Files */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">{t("dashboard.recentFiles.title")}</p>
              </div>
              <button
                onClick={() => navigate("/")}
                className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-primary"
              >
                {t("dashboard.recentFiles.viewAll")} <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("dashboard.recentFiles.colName")}
                    </th>
                    <th className="hidden w-[80px] px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:table-cell">
                      {t("dashboard.recentFiles.colType")}
                    </th>
                    <th className="hidden w-[130px] px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">
                      {t("dashboard.recentFiles.colOwner")}
                    </th>
                    <th className="w-[80px] whitespace-nowrap px-5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("dashboard.recentFiles.colTime")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentQuery.isLoading
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/30 last:border-0">
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <SkeletonLine className="h-7 w-7 flex-shrink-0 rounded-lg" />
                              <SkeletonLine className="h-3 w-32" />
                            </div>
                          </td>
                          <td className="hidden px-3 py-2.5 sm:table-cell">
                            <SkeletonLine className="h-4 w-10 rounded" />
                          </td>
                          <td className="hidden px-3 py-2.5 md:table-cell">
                            <SkeletonLine className="h-3 w-20" />
                          </td>
                          <td className="px-5 py-2.5">
                            <SkeletonLine className="ml-auto h-3 w-10" />
                          </td>
                        </tr>
                      ))
                    : (recentQuery.data ?? []).map((file) => {
                        const extKey = file.extension.toLowerCase().replace(/^\./, "");
                        const extLabel = extKey.toUpperCase();
                        return (
                          <tr
                            key={file.id}
                            onClick={() => handleOpenDoc(file.id)}
                            className="group cursor-pointer border-b border-border/30 transition-colors last:border-0 hover:bg-muted/30"
                          >
                            <td className="px-5 py-2.5">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <FileTypeIcon ext={extKey} />
                                <span className="truncate text-xs font-medium text-foreground transition-colors group-hover:text-primary">
                                  {file.title}
                                </span>
                              </div>
                            </td>
                            <td className="hidden px-3 py-2.5 sm:table-cell">
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[9px] font-semibold",
                                  fileTypeBadgeStyle[extKey] ?? "bg-gray-100 text-gray-500"
                                )}
                              >
                                {extLabel}
                              </span>
                            </td>
                            <td className="hidden px-3 py-2.5 md:table-cell">
                              <span className="block max-w-[120px] truncate text-[10px] text-muted-foreground">
                                {file.owner_name ?? "—"}
                              </span>
                            </td>
                            <td className="px-5 py-2.5 text-right">
                              <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                                {relativeTime(file.updated_at)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Shared Files */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">{t("dashboard.sharedFiles.title")}</p>
            </div>
            <button
              onClick={() => navigate("/?tab=shared")}
              className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              {t("dashboard.sharedFiles.viewAll")} <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("dashboard.sharedFiles.colName")}
                  </th>
                  <th className="hidden w-[80px] px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:table-cell">
                    {t("dashboard.sharedFiles.colType")}
                  </th>
                  <th className="hidden w-[140px] px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">
                    {t("dashboard.sharedFiles.colSharedBy")}
                  </th>
                  <th className="w-[80px] whitespace-nowrap px-5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("dashboard.sharedFiles.colTime")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sharedQuery.isLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/30 last:border-0">
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <SkeletonLine className="h-7 w-7 flex-shrink-0 rounded-lg" />
                            <SkeletonLine className="h-3 w-32" />
                          </div>
                        </td>
                        <td className="hidden px-3 py-2.5 sm:table-cell">
                          <SkeletonLine className="h-4 w-10 rounded" />
                        </td>
                        <td className="hidden px-3 py-2.5 md:table-cell">
                          <SkeletonLine className="h-3 w-24" />
                        </td>
                        <td className="px-5 py-2.5">
                          <SkeletonLine className="ml-auto h-3 w-10" />
                        </td>
                      </tr>
                    ))
                  : (sharedQuery.data ?? []).length === 0
                  ? (
                      <tr>
                        <td colSpan={4} className="px-5 py-8 text-center text-xs text-muted-foreground">
                          {t("dashboard.sharedFiles.empty")}
                        </td>
                      </tr>
                    )
                  : (sharedQuery.data ?? []).map((file) => {
                      const extKey = file.extension.toLowerCase().replace(/^\./, "");
                      const extLabel = extKey.toUpperCase();
                      return (
                        <tr
                          key={file.id}
                          onClick={() => handleOpenDoc(file.id)}
                          className="group cursor-pointer border-b border-border/30 transition-colors last:border-0 hover:bg-muted/30"
                        >
                          <td className="px-5 py-2.5">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <FileTypeIcon ext={extKey} />
                              <span className="truncate text-xs font-medium text-foreground transition-colors group-hover:text-primary">
                                {file.title}
                              </span>
                            </div>
                          </td>
                          <td className="hidden px-3 py-2.5 sm:table-cell">
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[9px] font-semibold",
                                fileTypeBadgeStyle[extKey] ?? "bg-gray-100 text-gray-500"
                              )}
                            >
                              {extLabel}
                            </span>
                          </td>
                          <td className="hidden px-3 py-2.5 md:table-cell">
                            <span className="block max-w-[130px] truncate text-[10px] text-muted-foreground">
                              {file.owner_name ?? "—"}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                              {relativeTime(file.updated_at)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <DocumentPreviewModal
        document={previewDoc}
        documents={previewDoc ? [previewDoc] : []}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}
