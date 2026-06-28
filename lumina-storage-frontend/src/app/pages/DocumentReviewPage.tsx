import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diff_match_patch } from "diff-match-patch";
import { useLocation } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  FileSearch, ArrowLeft, History, FileText, Sparkles,
  Save,
} from "lucide-react";
import {
  ALL_REVIEW_CHECKLIST_ITEMS,
  REVIEW_CHECKLISTS,
  reviewApi,
  type AnalysisResult,
  type QuickActionResult,
  type QuickActionType,
  type ReviewChecklistItem,
  type ReviewHistoryItem,
  type ReviewType,
  type ReviewVersionResponse,
} from "@/app/api/endpoints/review";
import type { ChecklistGroupResult, VersionEntry } from "@/app/components/doc-review/RightAnalysisSidebar";
import { documentsApi } from "@/app/api/endpoints/documents";
import {
  parseDocSections,
  type DocSection,
} from "@/app/utils/doc-review/sections";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/app/components/ui/dialog";
import { HorizontalStepBar, type ReviewStep } from "@/app/components/doc-review/HorizontalStepBar";
import { FilePicker, type PickedFile } from "@/app/components/doc-review/FilePicker";
import { RightStep2Config } from "@/app/components/doc-review/RightStep2Config";
import { CenterDocViewer } from "@/app/components/doc-review/CenterDocViewer";
import { RightAnalysisSidebar } from "@/app/components/doc-review/RightAnalysisSidebar";
import { ReviewedHistoryDrawer } from "@/app/components/doc-review/ReviewedHistoryDrawer";
import {
  ProgressHistoryDrawer,
  type SessionEvent,
  type SessionEventType,
} from "@/app/components/doc-review/ProgressHistoryDrawer";

type UIState = "empty" | "loading" | "success";

interface ReviewDocItem {
  id: string;
  name: string;
  date?: string;
  reviewed?: boolean;
}

const FILE_TYPE_RULES = [
  {
    label: "contract",
    keywords: ["hop dong", "contract", "nda", "agreement", "mou", "sal"],
  },
  {
    label: "report",
    keywords: ["bao cao", "report", "summary", "thong ke", "tong ket"],
  },
  {
    label: "process",
    keywords: ["quy trinh", "sop", "procedure", "process", "workflow"],
  },
  {
    label: "invoice",
    keywords: ["hoa don", "invoice", "bill", "receipt", "payment"],
  },
  {
    label: "minutes",
    keywords: ["bien ban", "minutes", "nghiem thu", "ban giao"],
  },
  {
    label: "proposal",
    keywords: ["de xuat", "proposal", "quotation", "bao gia"],
  },
] as const;

function normalizeFileName(name: string) {
  return name
    .replace(/\.[^/.]+$/, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[_\-./()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFileExt(name: string) {
  return name.split(".").pop()?.toUpperCase() ?? "DOC";
}

function detectFileType(name: string) {
  const normalizedName = normalizeFileName(name);

  const matchedRule = FILE_TYPE_RULES.find((rule) =>
    rule.keywords.some((keyword) =>
      normalizedName.includes(normalizeFileName(keyword))
    )
  );

  if (matchedRule) return matchedRule.label;

  return "default";
}

function getFileIconColor(name: string) {
  const ext = getFileExt(name);

  if (ext === "PDF") return "text-red-600 bg-red-50";
  if (["XLS", "XLSX", "CSV"].includes(ext)) return "text-emerald-600 bg-emerald-50";
  if (["PPT", "PPTX"].includes(ext)) return "text-orange-600 bg-orange-50";
  if (["DOC", "DOCX"].includes(ext)) return "text-blue-600 bg-blue-50";

  return "text-slate-600 bg-slate-50";
}
// ─── Empty state — Bước 1 ─────────────────────────────────────────────────

function EmptyChoose({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="w-full max-w-lg flex flex-col items-center justify-center text-center py-20 px-8 border-2 border-dashed border-border rounded-2xl bg-muted/20">
        <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
          <FileSearch className="w-7 h-7 text-brand-600" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{t("review.page.selectFileTitle")}</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">
          {t("review.page.selectFileDesc")}
        </p>
        <Button className="mt-5 gap-2" onClick={onOpen}>
          <FileSearch className="w-4 h-4" /> {t("review.page.openKnowledgeBase")}
        </Button>
      </div>
    </div>
  );
}

// ─── File scan card — khớp design: icon + badge + grid 3 cột ──────────────
function FileScanCard({ doc, pages }: { doc: ReviewDocItem; pages?: number}) {
  const { t } = useTranslation();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileTypeLabel = t(`review.page.fileTypes_${detectFileType(doc.name)}` as any) as string;
  const iconColor = getFileIconColor(doc.name);

  return (
    <div className="border border-border rounded-xl bg-card p-5 mb-5">
      <div className="flex items-start gap-4">
        <div className={`${iconColor} rounded-md flex items-center justify-center w-8 h-8 flex-shrink-0`}>
          <FileText className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {doc.name}
            </h3>

            <Badge
              variant="outline"
              className="text-[10px] gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 flex-shrink-0"
            >
              <Sparkles className="w-3 h-3" />
              {t("review.page.aiScanned")}
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                {t("review.page.fileTypeLabel")}
              </p>
              <p className="text-sm text-foreground mt-0.5">{fileTypeLabel}</p>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                {t("review.page.pageCountLabel")}
              </p>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <p className="text-sm text-foreground mt-0.5" title={ t("review.page.pageCountEstimated" as any)}>
                {pages != null ?  pages : "—"}
              </p>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                {t("review.page.updatedAtLabel")}
              </p>
              <p className="text-sm text-foreground mt-0.5">{doc.date ?? "—"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Checklist builder — Custom type dùng ALL items từ mọi loại ──────────

function buildChecklist(type: ReviewType): ReviewChecklistItem[] {
  if (type === "Custom") {
    return ALL_REVIEW_CHECKLIST_ITEMS.map((item) => ({ ...item, checked: false }));
  }
  return REVIEW_CHECKLISTS[type]
    .filter((item) => item.category !== "So sánh")
    .map((item) => ({ ...item, checked: false }));
}

// ─── MAIN PAGE ─────────────────────────────────────────────────────────────

export function DocumentReviewPage() {
  const { t } = useTranslation();
  const location = useLocation();

  // ── Step state ─────────────────────────────────────────────────────────────
  const [step, setStep] = useState<ReviewStep>(1);
  const [maxStep, setMaxStep] = useState<ReviewStep>(1);

  // ── File picker modal ─────────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const [comparePickerOpen, setComparePickerOpen] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);

  // ── Exit confirm ──────────────────────────────────────────────────────────
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [isSavingProgress, setIsSavingProgress] = useState(false);

  // ── Doc & source state ────────────────────────────────────────────────────
  const [selectedDoc, setSelectedDoc] = useState<ReviewDocItem | null>(null);

  // ── Config state (Bước 2) ─────────────────────────────────────────────────
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareDocIds, setCompareDocIds] = useState<string[]>([]);
  const [referenceEnabled, setReferenceEnabled] = useState(false);
  const [referenceDocIds, setReferenceDocIds] = useState<string[]>([]);
  const [referenceContent, setReferenceContent] = useState("");
  const [additionalRequirements, setAdditionalRequirements] = useState("");
  const [suggestingChecklist, setSuggestingChecklist] = useState(false);
  const [suggestRetryTick, setSuggestRetryTick] = useState(0);
  const [aiSuggestedIds, setAiSuggestedIds] = useState<string[] | null>(null);

  const [reviewType, setReviewType] = useState<ReviewType>("Legal");
  const [checklist, setChecklist] = useState<ReviewChecklistItem[]>(
    () => buildChecklist("Legal")
  );
  const [pendingReviewType, setPendingReviewType] = useState<ReviewType | null>(null);
  // GAP-13: IDs của các mục đã tick khi bắt đầu review — dùng để lọc kết quả checklist
  const [checkedItemIds, setCheckedItemIds] = useState<Set<string>>(new Set());

  // ── Analysis state (Bước 3) ───────────────────────────────────────────────
  const [uiState, setUiState] = useState<UIState>("empty");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [displayScore, setDisplayScore] = useState(0);
  const [compareMode, setCompareMode] = useState<"tracked" | "semantic" | null>(null);
  const [revisionsDetected, setRevisionsDetected] = useState<{
    document: number;
    template: number;
  }>({ document: 0, template: 0 });

  // ── Doc viewer state ──────────────────────────────────────────────────────
  const [sections, setSections] = useState<DocSection[]>([]);
  const [templateSections, setTemplateSections] = useState<DocSection[]>([]);
  const [viewingTemplate, setViewingTemplate] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ── Fix/action state ──────────────────────────────────────────────────────
  const [activeFix, setActiveFix] = useState<number | null>(null);
  const [ignoredFixes, setIgnoredFixes] = useState<Set<number>>(new Set());
  const [appliedFixes, setAppliedFixes] = useState<Record<string, string>>({});
  // Pending edits: user đã tick nhưng chưa Apply (preview trong document, chưa lưu version)
  const [pendingEdits, setPendingEdits] = useState<Record<string, { suggested: string; riskLevel: string; clauseName?: string }>>({});
  // Committed edits: đã Apply + lưu version, tích lũy qua các lần Apply
  const [committedEdits, setCommittedEdits] = useState<Record<string, { suggested: string; riskLevel: string; clauseName?: string }>>({});
  const [ignoredEditIds, setIgnoredEditIds] = useState<Set<string>>(new Set());
  const [quickActionResult, setQuickActionResult] = useState<QuickActionResult | null>(null);
  const [quickActionLoading, setQuickActionLoading] = useState(false);
  const [newEditIds, setNewEditIds] = useState<Set<string>>(new Set());
  const newEditIdsClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [scoreImprovement, setScoreImprovement] = useState<{ delta: number; summary: string } | null>(null);
  const recalcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queryClient = useQueryClient();

  // ── Version history tracking ──────────────────────────────────────────────
  const [versionHistory, setVersionHistory] = useState<VersionEntry[]>([]);
  const [activeVersionNum, setActiveVersionNum] = useState<number | null>(null);
  const prevVersionLengthRef = useRef(0);
  // Khi restore từ backend thì không hiện toast version
  const restoringVersionsRef = useRef(false);

  // Toast chỉ khi version được tạo mới trong session, không phải khi restore
  useEffect(() => {
    if (versionHistory.length > prevVersionLengthRef.current && versionHistory.length > 0) {
      if (!restoringVersionsRef.current) {
        const latest = versionHistory[versionHistory.length - 1];
        toast.success(`v${latest.num} · ${latest.label}`);
      }
    }
    prevVersionLengthRef.current = versionHistory.length;
    restoringVersionsRef.current = false;
  }, [versionHistory]);

  // ── Session event timeline ─────────────────────────────────────────────────
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [progressHistoryOpen, setProgressHistoryOpen] = useState(false);
  const saveEventsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save session events debounced 3s sau mỗi thay đổi
  useEffect(() => {
    if (!jobId || sessionEvents.length === 0) return;
    if (saveEventsTimerRef.current) clearTimeout(saveEventsTimerRef.current);
    saveEventsTimerRef.current = setTimeout(() => {
      reviewApi.saveSessionEvents(
        jobId,
        sessionEvents.map((e) => ({
          id: e.id,
          type: e.type,
          label: e.label,
          timestamp: e.timestamp.toISOString(),
        }))
      ).catch(console.error);
    }, 3000);
    return () => {
      if (saveEventsTimerRef.current) clearTimeout(saveEventsTimerRef.current);
    };
  }, [sessionEvents, jobId]);
  const [myDocsOpen, setMyDocsOpen] = useState(false);
  const reviewCountRef = useRef(0);
  const sessionVersionCountRef = useRef(0);
  const versionAnchorJobIdRef = useRef<string | null>(null);
  const fixCountRef = useRef(0);
  const docReadyRef = useRef(false);
  const jobMarkedCompletedRef = useRef(false);
  // true sau khi user đã lưu ít nhất 1 version (apply edits / save progress / restore)
  const [hasBeenCompleted, setHasBeenCompleted] = useState(false);

  const addSessionEvent = useCallback(
    (type: SessionEventType, label: string) => {
      setSessionEvents((prev) => [
        ...prev,
        { id: `${type}-${Date.now()}`, type, label, timestamp: new Date() },
      ]);
    },
    [setSessionEvents]
  );

  // ── Pre-load document from generator "Phân tích tài liệu" navigation ──────
  useEffect(() => {
    const state = location.state as { preloadDoc?: { documentId?: string; name?: string; date?: string } } | null;
    if (!state?.preloadDoc?.documentId) return;
    const { documentId, name, date } = state.preloadDoc;
    const doc: ReviewDocItem = { id: documentId, name: name ?? documentId, date };
    setSelectedDoc(doc);
    setStep(2);
    setMaxStep(2);
    addSessionEvent("file_selected", t("review.progress.eventFileSelected", { name: doc.name }));
    // Clear state so re-navigating to /review later starts fresh
    window.history.replaceState({}, "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── API queries ───────────────────────────────────────────────────────────
  const { data: historyResp, isLoading: historyLoading } = useQuery({
    queryKey: ["review-history"],
    queryFn: () => reviewApi.getHistory({ limit: 50 }),
    staleTime: 10_000,
  });

  const deleteHistoryMutation = useMutation({
    mutationFn: (jid: string) => reviewApi.deleteHistoryItem(jid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-history"] });
      toast.success(t("review.page.deletedFromHistory"));
    },
    onError: () => toast.error(t("review.page.deleteFailed")),
  });

  const { data: docsPage } = useQuery({
    queryKey: ["review-documents"],
    queryFn: () =>
      documentsApi.list({ page: 1, page_size: 100, sort_by: "updated_at", sort_order: "desc" }),
    staleTime: 30_000,
  });

  const reviewedNames = useMemo(
    () => new Set((historyResp?.items ?? []).map((h) => h.document_name)),
    [historyResp]
  );

  const documents: ReviewDocItem[] = useMemo(
    () =>
      (docsPage?.items ?? []).map((d) => {
        const name = d.original_filename ?? d.title ?? d.id;
        const date =
          (d as { updated_at?: string }).updated_at ??
          (d as { created_at?: string }).created_at;
        return {
          id: d.id,
          name,
          date: date ? date.slice(0, 10) : undefined,
          reviewed: reviewedNames.has(name),
        };
      }),
    [docsPage, reviewedNames]
  );

  const { data: docTextResp } = useQuery({
    queryKey: ["review-doc-text", selectedDoc?.id],
    queryFn: () => reviewApi.getDocumentText(selectedDoc!.id),
    enabled: !!selectedDoc?.id,
    staleTime: 60_000,
  });

  const primaryCompareDocId = compareDocIds[0] ?? "";
  const { data: templateTextResp } = useQuery({
    queryKey: ["review-doc-text", primaryCompareDocId],
    queryFn: () => reviewApi.getDocumentText(primaryCompareDocId),
    enabled: !!primaryCompareDocId,
    staleTime: 60_000,
  });


  // ── AI suggest checklist ───────────────────────────────────────────────────
  // Only trigger when user is on step 2 (document text is visible) and text is
  // meaningful — prevents premature API calls while user is still on step 1.
  const suggestTriggeredRef = useRef<string | null>(null);
  useEffect(() => {
    const docId = selectedDoc?.id;
    const text = docTextResp?.text ?? "";
    if (!docId || step !== 2 || text.trim().length < 50) return;
    const key = `${docId}:${reviewType}`;
    if (suggestTriggeredRef.current === key) return;
    suggestTriggeredRef.current = key;

    setSuggestingChecklist(true);
    reviewApi
      .suggestChecklist(docId, reviewType)
      .then((resp) => {
        if (!resp.suggested_ids.length) return;
        setAiSuggestedIds(resp.suggested_ids);
        setChecklist((prev) =>
          prev.map((item) =>
            resp.suggested_ids.includes(item.id) ? { ...item, checked: true } : { ...item, checked: false }
          )
        );
        toast.success(
          t("review.wizard.suggestChecklistApplied", { count: resp.suggested_ids.length })
        );
      })
      .catch(() => {
        toast.error(t("review.wizard.suggestChecklistFailed"));
        suggestTriggeredRef.current = null; // allow retry
      })
      .finally(() => setSuggestingChecklist(false));
  }, [selectedDoc?.id, docTextResp?.text, reviewType, step, suggestRetryTick, t]);

  // ── Parse document text → sections ───────────────────────────────────────
  useEffect(() => {
    const text = docTextResp?.text ?? "";
    if (selectedDoc && text) {
      setSections(parseDocSections(text));
      if (!docReadyRef.current) {
        docReadyRef.current = true;
        addSessionEvent("ai_scan", t("review.progress.eventAiScan"));
      }
    } else if (!selectedDoc) {
      setSections([]);
      docReadyRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoc, docTextResp, addSessionEvent]);

  // ── Reset analysis when doc changes ──────────────────────────────────────
  const reopeningRef = useRef(false);
  useEffect(() => {
    if (reopeningRef.current) {
      reopeningRef.current = false;
      return;
    }
    setUiState("empty");
    setResult(null);
    setJobId(null);
    setAppliedFixes({});
    setPendingEdits({});
    setCommittedEdits({});
    setIgnoredEditIds(new Set());
    setIgnoredFixes(new Set());
    setActiveFix(null);
    setQuickActionResult(null);
    setViewingTemplate(false);
    reviewCountRef.current = 0;
    fixCountRef.current = 0;
    docReadyRef.current = false;
    jobMarkedCompletedRef.current = false;
    if (selectedDoc) {
      setSessionEvents([{
        id: `file_selected-${Date.now()}`,
        type: "file_selected",
        label: t("review.progress.eventFileSelected", { name: selectedDoc.name }),
        timestamp: new Date(),
      }]);
    } else {
      setSessionEvents([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoc, setSessionEvents]);

  // ── Parse template text ───────────────────────────────────────────────────
  useEffect(() => {
    const text = templateTextResp?.text ?? "";
    if (primaryCompareDocId && text) {
      setTemplateSections(parseDocSections(text));
    } else {
      setTemplateSections([]);
      setViewingTemplate(false);
    }
  }, [primaryCompareDocId, templateTextResp]);

  // ── Restore version: tạo checkpoint mới từ state của version cũ ────────────
  const handleRestoreVersion = useCallback((num: number) => {
    const entry = versionHistory.find((v) => v.num === num);
    if (!entry || !jobId) return;
    const anchorJobId = versionAnchorJobIdRef.current ?? jobId;
    sessionVersionCountRef.current += 1;
    const vNum = sessionVersionCountRef.current;
    const versionLabel = t("review.page.restoreVersionLabel", { n: num });
    const restoredEdits = entry.appliedEdits ?? {};
    const restoredResult = entry.result;

    // Cập nhật state hiện tại về trạng thái của version được khôi phục
    setCommittedEdits(restoredEdits);
    setPendingEdits({});
    setResult(restoredResult);
    setQuickActionResult(restoredResult?.quickActionResult ?? null);
    setActiveVersionNum(null);
    setScoreImprovement(null);

    addSessionEvent("restored", t("review.page.versionRestored", { n: num, label: entry.label }));
    toast.success(t("review.page.restoreVersionSuccess", { n: num }));

    const versionEntry: VersionEntry = {
      num: vNum,
      label: versionLabel,
      type: "restore",
      score: restoredResult.riskScore ?? entry.score,
      reviewType,
      timestamp: new Date(),
      result: restoredResult,
      appliedEdits: restoredEdits,
    };
    reviewApi.saveVersion(anchorJobId, {
      version_num: vNum,
      label: versionLabel,
      type: "restore",
      score: versionEntry.score,
      review_type: reviewType,
      result: restoredResult,
      applied_edits: restoredEdits,
    }).then((saved) => {
      setVersionHistory((vh) => vh.map((v) => v.num === vNum ? { ...v, id: saved.id } : v));
      if (!jobMarkedCompletedRef.current) {
        jobMarkedCompletedRef.current = true;
        setHasBeenCompleted(true);
        reviewApi.updateStatus(anchorJobId, "completed")
          .then(() => queryClient.invalidateQueries({ queryKey: ["review-history"] }))
          .catch(() => {});
      }
    }).catch(console.error);
    setVersionHistory((prev) => [...prev, versionEntry]);
  }, [versionHistory, jobId, reviewType, addSessionEvent, t]);

  // ── Version switching ─────────────────────────────────────────────────────
  const handleSwitchVersion = useCallback((num: number | null) => {
    setActiveVersionNum(num);
    if (num === null) {
      const latest = versionHistory[versionHistory.length - 1];
      if (latest) {
        toast.info(t("review.page.versionRestoredLatest", { n: latest.num, label: latest.label }));
        setCommittedEdits(latest.appliedEdits ?? {});
        setPendingEdits({});
        setQuickActionResult(latest.result?.quickActionResult ?? null);
      }
    } else {
      const entry = versionHistory.find((v) => v.num === num);
      if (entry) {
        toast.info(t("review.page.versionViewing", { n: entry.num, label: entry.label }));
        setCommittedEdits(entry.appliedEdits ?? {});
        setPendingEdits({});
        setNewEditIds(new Set());
        if (newEditIdsClearTimerRef.current) { clearTimeout(newEditIdsClearTimerRef.current); newEditIdsClearTimerRef.current = null; }
      }
    }
  }, [versionHistory, t]);

  // Helper: chuyển ReviewVersionResponse thành VersionEntry
  const versionResponseToEntry = useCallback(
    (v: ReviewVersionResponse): VersionEntry => ({
      id: v.id,
      num: v.version_num,
      label: v.label,
      type: v.type as VersionEntry["type"],
      score: v.score,
      reviewType: v.review_type ?? undefined,
      timestamp: new Date(v.created_at),
      result: v.result as AnalysisResult,
      appliedEdits: v.applied_edits,
    }),
    []
  );

  const sidebarResult = useMemo(() => {
    if (activeVersionNum === null) return result;
    return versionHistory.find((v) => v.num === activeVersionNum)?.result ?? result;
  }, [activeVersionNum, versionHistory, result]);

  // ── Animate risk score ────────────────────────────────────────────────────
  useEffect(() => {
    const target = sidebarResult?.riskScore ?? 0;
    if (!target) { setDisplayScore(0); return; }
    let current = 0;
    const stepVal = Math.max(1, Math.ceil(target / 30));
    const timer = setInterval(() => {
      current = Math.min(current + stepVal, target);
      setDisplayScore(current);
      if (current >= target) clearInterval(timer);
    }, 30);
    return () => clearInterval(timer);
  }, [sidebarResult]);

  // ── Checklist handlers ────────────────────────────────────────────────────
  const toggleChecklistItem = useCallback((id: string) => {
    setChecklist((prev) =>
      prev.map((item) => item.id === id ? { ...item, checked: !item.checked } : item)
    );
  }, []);

  const resetChecklistToAi = useCallback(() => {
    if (!aiSuggestedIds) return;
    setChecklist((prev) =>
      prev.map((item) => ({ ...item, checked: aiSuggestedIds.includes(item.id) }))
    );
  }, [aiSuggestedIds]);

  const toggleCategoryItems = useCallback((category: string, checked: boolean) => {
    setChecklist((prev) =>
      prev.map((item) => item.category === category ? { ...item, checked } : item)
    );
  }, []);

  const selectAllChecklist = useCallback(() => {
    setChecklist((prev) => prev.map((item) => ({ ...item, checked: true })));
  }, []);

  const clearAllChecklist = useCallback(() => {
    setChecklist((prev) => prev.map((item) => ({ ...item, checked: false })));
  }, []);

  // Intercept review type change — nếu đã có checked items thì show confirm dialog
  const handleReviewTypeChange = useCallback(
    (type: ReviewType) => {
      if (type === reviewType) return;
      const hasChecked = checklist.some((c) => c.checked);
      if (hasChecked) {
        setPendingReviewType(type);
      } else {
        setReviewType(type);
        setChecklist(buildChecklist(type));
        setAiSuggestedIds(null);
      }
    },
    [reviewType, checklist]
  );

  // ── File picker confirm ───────────────────────────────────────────────────
  const handleMainFilePicked = useCallback(
    (files: PickedFile[]) => {
      const f = files[0];
      if (!f) return;
      const doc: ReviewDocItem = { id: f.id, name: f.name, date: f.date };
      setSelectedDoc(doc);
      addSessionEvent(
        "file_selected",
        t("review.progress.eventFileSelected", { name: f.name })
      );
      setStep(2);
      setMaxStep((prev) => Math.max(prev, 2) as ReviewStep);
    },
    [addSessionEvent, t]
  );

  const handleCompareFilePicked = useCallback(
    (files: PickedFile[]) => {
      setCompareDocIds((prev) => {
        const existingIds = new Set(prev);
        const newIds = files.map((f) => f.id).filter((id) => !existingIds.has(id));
        return [...prev, ...newIds];
      });
    },
    []
  );

  const handleReferenceFilePicked = useCallback(
    (files: PickedFile[]) => {
      setReferenceDocIds((prev) => {
        const existingIds = new Set(prev);
        const newIds = files.map((f) => f.id).filter((id) => !existingIds.has(id));
        return [...prev, ...newIds];
      });
    },
    []
  );

  // ── Run review ────────────────────────────────────────────────────────────
  const handleRunReview = useCallback(async () => {
    if (!selectedDoc) return;

    // Nếu checklist "So sánh" được tick mà chưa chọn tài liệu đối chiếu → chặn
    const compareChecked = checklist.some(
      (c) => c.checked && (c.category === "So sánh" || c.id.endsWith("-cmp-1"))
    );
    if (compareChecked && compareDocIds.length === 0) {
      toast.error(t("review.history.compareNeedTemplate"), { duration: 5000 });
      return;
    }
    if (compareEnabled && compareDocIds.length === 0) {
      toast.error(t("review.history.compareModeNoTemplate"), { duration: 5000 });
      return;
    }

    setUiState("loading");
    setActiveFix(null);
    setIgnoredFixes(new Set());
    setAppliedFixes({});
    setPendingEdits({});
    setCommittedEdits({});
    setIgnoredEditIds(new Set());
    setQuickActionResult(null);
    setNewEditIds(new Set());
    setScoreImprovement(null);
    reviewCountRef.current += 1;
    const reviewNum = reviewCountRef.current;
    addSessionEvent(
      "review_start",
      t("review.progress.eventReviewStart", { n: reviewNum, type: reviewType })
    );

    try {
      const checkedIds = checklist.filter((c) => c.checked).map((c) => c.id);
      setCheckedItemIds(new Set(checkedIds));
      const startResp = await reviewApi.start({
        document_id: selectedDoc.id,
        doc_source: "drive",
        review_type: reviewType,
        checklist_item_ids: checkedIds,
        compare_enabled: compareEnabled,
        compare_document_ids: compareEnabled ? compareDocIds : [],
        template_source: compareEnabled ? "drive" : undefined,
        additional_requirements: additionalRequirements.trim() || undefined,
        reference_enabled: referenceEnabled,
        reference_doc_ids: referenceEnabled ? referenceDocIds : [],
        reference_content: referenceEnabled ? referenceContent.trim() || undefined : undefined,
      });

      const report = await reviewApi.getResult(startResp.job_id);
      setJobId(startResp.job_id);
      if (!versionAnchorJobIdRef.current) {
        versionAnchorJobIdRef.current = startResp.job_id;
      }
      const versionJobId = versionAnchorJobIdRef.current;
      setResult({
        ...report,
        additionalRequirements: additionalRequirements.trim() || undefined,
      });
      // Chỉ áp dụng compare_mode nếu người dùng thực sự bật so sánh — backend có thể trả "tracked"
      // khi phát hiện track changes trong doc mà không cần compare_enabled=true
      setCompareMode(compareEnabled ? startResp.compare_mode : null);
      setRevisionsDetected(startResp.revisions_detected);
      setUiState("success");
      setActiveVersionNum(null);
      sessionVersionCountRef.current += 1;
      const newVersionNum = sessionVersionCountRef.current;
      addSessionEvent("version_saved", t("review.page.versionCreatedAiReview", { n: newVersionNum }));
      reviewApi.saveVersion(versionJobId, {
        version_num: newVersionNum,
        label: t("review.page.versionLabelAiReview"),
        type: "ai_review",
        score: report.riskScore,
        review_type: reviewType,
        result: report,
      }).then((saved) => {
        setVersionHistory((vh) =>
          vh.map((v) => (v.num === newVersionNum ? { ...v, id: saved.id } : v))
        );
      }).catch(console.error);
      setVersionHistory((prev) => [
        ...prev,
        {
          num: newVersionNum,
          label: t("review.page.versionLabelAiReview"),
          type: "ai_review" as const,
          score: report.riskScore,
          reviewType,
          timestamp: new Date(),
          result: report,
        },
      ]);
      // Advance to step 3
      setStep(3);
      setMaxStep(3);
      addSessionEvent(
        "review_done",
        t("review.progress.eventReviewDone", { n: reviewNum, type: reviewType })
      );
      queryClient.invalidateQueries({ queryKey: ["review-history"] });
    } catch (err) {
      console.error(err);
      toast.error(t("review.page.reviewFailed"));
      setUiState("empty");
    }
  }, [
    selectedDoc,
    reviewType,
    checklist,
    compareEnabled,
    compareDocIds,
    additionalRequirements,
    referenceEnabled,
    referenceDocIds,
    referenceContent,
    addSessionEvent,
    queryClient,
    t,
  ]);

  // ── Reopen history ────────────────────────────────────────────────────────
  const handleReopenHistory = useCallback(
    async (item: ReviewHistoryItem) => {
      try {
        const [report, savedVersions] = await Promise.all([
          reviewApi.getResult(item.id),
          reviewApi.getVersions(item.id).catch(() => [] as ReviewVersionResponse[]),
        ]);
        const doc = documents.find((d) => d.name === item.document_name);
        if (doc) {
          reopeningRef.current = true;
          // Ngăn suggest checklist tự động fire khi reopen
          suggestTriggeredRef.current = `${doc.id}:${item.review_type}`;
          setSelectedDoc(doc);
        }
        setReviewType(item.review_type as ReviewType);

        // Restore checklist: build correct type, mark items that were checked in this review
        const restoredCheckedIds = new Set(
          (report.checklist ?? []).map((c: { id: string }) => c.id)
        );
        setChecklist(
          buildChecklist(item.review_type as ReviewType).map((cl) => ({
            ...cl,
            checked: restoredCheckedIds.has(cl.id),
          }))
        );
        setCheckedItemIds(restoredCheckedIds);

        setJobId(item.id);
        versionAnchorJobIdRef.current = item.id;
        // Chỉ mark completed nếu job thật sự đã completed — reviewing = chưa lưu tiến trình
        if (item.status === "completed") {
          jobMarkedCompletedRef.current = true;
          setHasBeenCompleted(true);
        } else {
          jobMarkedCompletedRef.current = false;
          setHasBeenCompleted(false);
        }
        setResult(report);
        setCompareMode(item.compare_mode);
        setRevisionsDetected({ document: 0, template: 0 });
        setUiState("success");
        setStep(3);
        setMaxStep(3);
        setActiveVersionNum(null);
        // Reset apply state trước, rồi restore từ version nếu có
        setPendingEdits({});
        setCommittedEdits({});
        setIgnoredEditIds(new Set());
        setAppliedFixes({});
        setIgnoredFixes(new Set());
        if (savedVersions.length > 0) {
          // Đánh dấu restore để không hiện toast version
          restoringVersionsRef.current = true;
          prevVersionLengthRef.current = 0;
          const entries = savedVersions.map(versionResponseToEntry);
          setVersionHistory(entries);
          sessionVersionCountRef.current = entries.length;
          // Use latest version's result (may differ from initial report for ai_request versions)
          const latestEntry = entries[entries.length - 1];
          if (latestEntry?.result) {
            setResult({
              ...latestEntry.result,
              riskScore: report.riskScore !== undefined ? report.riskScore : latestEntry.result.riskScore,
            });
          }
          // Restore additionalRequirements from the first version that has it (set during initial review)
          const latestWithReqs = [...entries].find((v) => v.result?.additionalRequirements);
          if (latestWithReqs?.result?.additionalRequirements) {
            setAdditionalRequirements(latestWithReqs.result.additionalRequirements);
          }
          // Restore quickActionResult from latest version that has one
          const latestWithQA = [...entries].reverse().find((v) => v.result?.quickActionResult);
          setQuickActionResult(latestWithQA?.result?.quickActionResult ?? null);
          // Restore appliedEdits from report._appliedEdits first, fallback to the latest version that has them
          if (report._appliedEdits && Object.keys(report._appliedEdits).length > 0) {
            setCommittedEdits(report._appliedEdits);
          } else {
            const latestWithEdits = [...entries].reverse().find(
              (v) => v.appliedEdits && Object.keys(v.appliedEdits).length > 0
            );
            if (latestWithEdits?.appliedEdits) {
              setCommittedEdits(latestWithEdits.appliedEdits);
            }
          }
        } else {
          setVersionHistory([]);
          if (report._appliedEdits && Object.keys(report._appliedEdits).length > 0) {
            setCommittedEdits(report._appliedEdits);
          }
        }
        if (report.sessionEvents && report.sessionEvents.length > 0) {
          setSessionEvents(
            report.sessionEvents.map((e) => ({
              id: e.id,
              type: e.type as SessionEventType,
              label: e.label,
              timestamp: new Date(e.timestamp),
            }))
          );
        }
        toast.success(t("review.page.reopenSuccess", { name: item.document_name }));
      } catch {
        toast.error(t("review.page.reopenFailed"));
      }
    },
    [documents, versionResponseToEntry]
  );

  // ── Fix/export handlers ───────────────────────────────────────────────────

  const handleApplyFix = useCallback(
    (keyword: string, text: string) => {
      setAppliedFixes((prev) => ({ ...prev, [keyword]: text }));
      fixCountRef.current += 1;
      addSessionEvent(
        "fix_applied",
        t("review.progress.eventFixApplied", { n: fixCountRef.current })
      );
    },
    [addSessionEvent, t]
  );

  const handleIgnoreFix = useCallback((idx: number) => {
    setIgnoredFixes((prev) => { const next = new Set(prev); next.add(idx); return next; });
  }, []);


  const handleApplyEdit = useCallback(
    (
      editId: string,
      modifiedText: string,
      suggested: string,
      riskLevel: string,
      clauseName = "",
      bilingualModifiedText?: string | null,
      bilingualSuggestedText?: string | null,
    ) => {
      void editId;
      const newPending: Record<string, { suggested: string; riskLevel: string; clauseName?: string }> = {
        [modifiedText]: { suggested, riskLevel, clauseName }
      };
      if (bilingualModifiedText && bilingualSuggestedText) {
        newPending[bilingualModifiedText] = { suggested: bilingualSuggestedText, riskLevel, clauseName };
      }
      setPendingEdits((prev) => ({ ...prev, ...newPending }));
      fixCountRef.current += 1;
      addSessionEvent("fix_applied", t("review.progress.eventFixApplied", { n: fixCountRef.current }));
    },
    [addSessionEvent, t]
  );

  const handleIgnoreEdit = useCallback((editId: string) => {
    setIgnoredEditIds((prev) => { const next = new Set(prev); next.add(editId); return next; });
  }, []);

  const handleUndoEdit = useCallback((modifiedText: string, bilingualModifiedText?: string | null) => {
    setPendingEdits((prev) => {
      const next = { ...prev };
      delete next[modifiedText];
      if (bilingualModifiedText) delete next[bilingualModifiedText];
      return next;
    });
    addSessionEvent("fix_applied", t("review.page.undoEditEvent"));
  }, [addSessionEvent, t]);

  const handleApplyAllEdits = useCallback(
    (edits: Array<{
      id: string;
      modifiedText: string;
      suggested: string;
      riskLevel: string;
      clauseName: string;
      bilingualModifiedText?: string | null;
      bilingualSuggestedText?: string | null;
    }>) => {
      if (!edits.length) return;
      const newPending: Record<string, { suggested: string; riskLevel: string; clauseName?: string }> = {};
      edits.forEach(({ modifiedText, suggested, riskLevel, clauseName, bilingualModifiedText, bilingualSuggestedText }) => {
        newPending[modifiedText] = { suggested, riskLevel, clauseName };
        if (bilingualModifiedText && bilingualSuggestedText) {
          newPending[bilingualModifiedText] = { suggested: bilingualSuggestedText, riskLevel, clauseName };
        }
      });
      setPendingEdits((prev) => ({ ...prev, ...newPending }));
      fixCountRef.current += edits.length;
      addSessionEvent("fix_applied", t("review.page.appliedEditsEvent", { count: edits.length }));
    },
    [addSessionEvent, t]
  );

  // Apply: commit pending edits của tab hiện tại → recalculate → lưu version với điểm đúng
  const handleSaveVersion = useCallback(async (label?: string, editsToSave?: Record<string, { suggested: string; riskLevel: string; clauseName?: string }>) => {
    if (!result || !jobId) return;
    const anchorJobId = versionAnchorJobIdRef.current ?? jobId;
    sessionVersionCountRef.current += 1;
    const vNum = sessionVersionCountRef.current;
    const savedEdits = editsToSave ?? pendingEdits;
    const versionLabel = label ?? t("review.page.applyEditsDefaultLabel", { count: Object.keys(savedEdits).length });
    const newCommitted = { ...committedEdits, ...savedEdits };

    // Cập nhật UI state ngay lập tức
    setCommittedEdits(newCommitted);
    setPendingEdits((prev) => {
      const next = { ...prev };
      Object.keys(savedEdits).forEach((k) => delete next[k]);
      return next;
    });
    addSessionEvent("version_saved", t("review.page.versionCreated", { n: vNum, label: versionLabel }));

    // Cancel debounce timer nếu đang chờ
    if (recalcTimerRef.current) clearTimeout(recalcTimerRef.current);

    // Recalculate trước để lấy điểm đúng, rồi mới lưu version lên backend
    let finalScore = result.riskScore ?? 0;
    setIsRecalculating(true);
    try {
      const qaEdits = result.comparison?.edits?.filter((e) => e.is_quick_action || e.id?.startsWith("qa-")) || [];
      const resp = await reviewApi.recalculateScore(jobId, newCommitted, qaEdits);
      finalScore = resp.newScore;
      setResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          riskScore: resp.newScore,
          quickActionResult: prev.quickActionResult
            ? { ...prev.quickActionResult, newScore: resp.newScore }
            : undefined
        };
      });
      // Sync quickActionResult.newScore so the sidebar shows the freshly recalculated score
      // (sidebar renders `quickActionResult.newScore` when quickActionResult is set)
      setQuickActionResult((prev) => prev ? { ...prev, newScore: resp.newScore } : null);
      if (resp.delta > 0) setScoreImprovement({ delta: resp.delta, summary: resp.summary });
      queryClient.invalidateQueries({ queryKey: ["review-history"] });
    } catch {
      // silent — dùng điểm cũ làm fallback
    } finally {
      setIsRecalculating(false);
    }

    const versionResult = {
      ...result,
      riskScore: finalScore,
      quickActionResult: result.quickActionResult
        ? { ...result.quickActionResult, newScore: finalScore }
        : undefined
    };
    reviewApi.saveVersion(anchorJobId, {
      version_num: vNum,
      label: versionLabel,
      type: "apply_suggestion",
      score: finalScore,
      review_type: reviewType,
      result: versionResult,
      applied_edits: newCommitted,
    }).then(async (saved) => {
      setVersionHistory((vh) => vh.map((v) => v.num === vNum ? { ...v, id: saved.id } : v));

      // Save session events as well to ensure progress is fully saved!
      if (sessionEvents.length > 0) {
        try {
          await reviewApi.saveSessionEvents(
            anchorJobId,
            sessionEvents.map((e) => ({
              id: e.id,
              type: e.type,
              label: e.label,
              timestamp: e.timestamp.toISOString(),
            }))
          );
        } catch (e) {
          console.error("Failed to save session events during version save:", e);
        }
      }

      if (!jobMarkedCompletedRef.current) {
        jobMarkedCompletedRef.current = true;
        setHasBeenCompleted(true);
        reviewApi.updateStatus(anchorJobId, "completed")
          .then(() => queryClient.invalidateQueries({ queryKey: ["review-history"] }))
          .catch(() => {});
      }
    }).catch(console.error);

    setVersionHistory((prev) => [
      ...prev,
      { num: vNum, label: versionLabel, type: "apply_suggestion" as const, score: finalScore, reviewType, timestamp: new Date(), result: versionResult, appliedEdits: newCommitted },
    ]);
  }, [result, jobId, reviewType, pendingEdits, committedEdits, sessionEvents, addSessionEvent, queryClient, t]);

  const handleAnchorClick = useCallback((keyword: string) => {
    if (!keyword?.trim()) return;

    // Remove stale inline highlights from previous navigation
    document.querySelectorAll<HTMLElement>("mark.lumina-hl").forEach((m) => {
      if (m.parentNode) {
        const frag = document.createDocumentFragment();
        while (m.firstChild) frag.appendChild(m.firstChild);
        m.parentNode.replaceChild(frag, m);
      }
    });

    // normFull: strips diacritics + punctuation — used only for section ID fallback matching
    const normFull = (s: string) =>
      s.toLowerCase().normalize("NFD")
        .replace(/[̀-ͯ]/g, "").replace(/đ/g, "d")
        .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

    const searchKey   = keyword.slice(0, 80);
    const searchLower = searchKey.toLowerCase();
    const searchNorm  = normFull(searchKey);
    if (!searchNorm) return;

    // Strip all leading list prefixes iteratively — handles "* 1. text", "1. text", "* text"
    const stripAllListPrefixes = (s: string): string => {
      const re = /^\s*(?:[*+\-]\s+|\d+(?:\.\d+)*[.\-):]\s+|[a-zA-Z][.)]\s+)/;
      let cur = s;
      for (let i = 0; i < 5; i++) {
        const next = cur.replace(re, "").trimStart();
        if (next === cur) break;
        cur = next;
      }
      return cur;
    };
    const strippedKey = stripAllListPrefixes(searchKey);
    const strippedLower = strippedKey.toLowerCase();
    const hasListPrefix = strippedKey !== searchKey.trimStart() && strippedKey.length > 4;

    // Strip markdown heading markers (# ## ###) and table pipe chars (| text |)
    // mammoth.js renders <h1>/<td> with no # or | in text nodes; LLM may copy them verbatim.
    const stripMdArtifacts = (s: string): string =>
      s.replace(/^#{1,6}\s+/, "").replace(/^\|\s*/, "").replace(/\s*\|$/, "").trim();
    const strippedMdKey = stripMdArtifacts(searchKey.trim());
    const strippedMdLower = strippedMdKey.toLowerCase();
    const hasMdArtifacts = strippedMdKey !== searchKey.trim() && strippedMdKey.length > 4;

      // ── 1. Find section ───────────────────────────────────────────────────────
      let sectionEl: HTMLDivElement | null = null;

      // A) Exact case-insensitive substring in rendered text (best for verbatim anchor_text)
      for (const el of Object.values(sectionRefs.current)) {
        if (!el) continue;
        if ((el.textContent ?? "").toLowerCase().includes(searchLower)) { sectionEl = el; break; }
      }
      // A2) Retry without list prefix (Word auto-numbered lists omit "1." from text nodes)
      if (!sectionEl && hasListPrefix) {
        for (const el of Object.values(sectionRefs.current)) {
          if (!el) continue;
          if ((el.textContent ?? "").toLowerCase().includes(strippedLower)) { sectionEl = el; break; }
        }
      }
      // A3) Retry without markdown heading/pipe artifacts (mammoth DOM has no # or | chars)
      if (!sectionEl && hasMdArtifacts) {
        for (const el of Object.values(sectionRefs.current)) {
          if (!el) continue;
          if ((el.textContent ?? "").toLowerCase().includes(strippedMdLower)) { sectionEl = el; break; }
        }
      }

      // B) Whitespace-normalised match (\n ↔ space differences from LLM)
      if (!sectionEl) {
        const keyWS = searchLower.replace(/\s+/g, " ").trim();
        for (const el of Object.values(sectionRefs.current)) {
          if (!el) continue;
          if ((el.textContent ?? "").replace(/\s+/g, " ").toLowerCase().includes(keyWS)) { sectionEl = el; break; }
        }
      }

      // C) Section ID slug match — fallback for clause-name-style keywords
      if (!sectionEl) {
        for (const [id, el] of Object.entries(sectionRefs.current)) {
          if (!el) continue;
          const nid = normFull(id);
          if (nid.length >= 5 && (nid.includes(searchNorm) || searchNorm.includes(nid))) { sectionEl = el; break; }
        }
      }

      if (!sectionEl) return;
      const sEl = sectionEl; // stable non-null ref for closures

      // ── 2. Build DOM Range from accumulated char index across text nodes ──────
      const buildRange = (
        root: HTMLElement,
        startIdx: number,
        matchLen: number,
        getText: (n: Node) => string,
      ): Range | null => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let seen = 0;
        let sN: Node | null = null, sOff = 0, eN: Node | null = null, eOff = 0, n: Node | null;
        while ((n = walker.nextNode())) {
          const t = getText(n); const len = t.length;
          if (!sN && seen + len > startIdx) { sN = n; sOff = startIdx - seen; }
          if (sN && !eN && seen + len >= startIdx + matchLen) { eN = n; eOff = startIdx + matchLen - seen; break; }
          seen += len;
        }
        if (!sN || !eN) return null;
        try {
          const r = document.createRange();
          r.setStart(sN, Math.max(0, Math.min(sOff, (sN.textContent ?? "").length)));
          r.setEnd(eN,   Math.max(0, Math.min(eOff, (eN.textContent ?? "").length)));
          return r;
        } catch { return null; }
      };

      // ── 3. Highlight matched Range ────────────────────────────────────────────
      const highlightRange = (range: Range) => {
        try {
          const mark = document.createElement("mark");
          mark.className = "lumina-hl";
          mark.style.cssText = "background:rgba(99,102,241,0.22);border-radius:2px;outline:1.5px solid rgba(99,102,241,0.45);outline-offset:1px;";
          range.surroundContents(mark);
          setTimeout(() => {
            if (mark.parentNode) {
              const frag = document.createDocumentFragment();
              while (mark.firstChild) frag.appendChild(mark.firstChild);
              mark.parentNode.replaceChild(frag, mark);
            }
          }, 1800);
        } catch {
          // Range spans element boundaries — outline the nearest containing element
          const anc = range.commonAncestorContainer;
          const target = (anc.nodeType === Node.TEXT_NODE ? anc.parentElement : anc as HTMLElement) ?? sEl;
          if (target !== sEl) {
            target.style.outline = "2px solid rgba(99,102,241,0.5)";
            target.style.borderRadius = "2px";
            setTimeout(() => { target.style.outline = ""; target.style.borderRadius = ""; }, 1800);
          } else {
            sEl.style.transition = "background-color 0.3s";
            sEl.style.backgroundColor = "rgba(99,102,241,0.08)";
            setTimeout(() => { sEl.style.backgroundColor = ""; }, 1800);
          }
        }
      };

      // ── 4. Scroll viewport to Range ───────────────────────────────────────────
      const scrollToRange = (range: Range) => {
        const viewport = sEl.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
        if (viewport) {
          const rect   = range.getBoundingClientRect();
          const vpRect = viewport.getBoundingClientRect();
          const top = viewport.scrollTop + rect.top - vpRect.top - viewport.clientHeight / 2 + rect.height / 2;
          viewport.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        } else {
          (range.startContainer.parentElement ?? sEl).scrollIntoView({ behavior: "smooth", block: "center" });
        }
        highlightRange(range);
      };

      // ── 5. Step A: edit đã apply → tìm <del class="edit-del"> ────────────────
      const matchingDel = Array.from(sEl.querySelectorAll<HTMLElement>("del.edit-del"))
        .find((d) => (d.textContent ?? "").toLowerCase().includes(searchLower.slice(0, 40)));
      if (matchingDel) {
        matchingDel.scrollIntoView({ behavior: "smooth", block: "center" });
        matchingDel.style.outline = "2px solid rgba(99,102,241,0.6)";
        matchingDel.style.borderRadius = "2px";
        setTimeout(() => { matchingDel.style.outline = ""; matchingDel.style.borderRadius = ""; }, 1800);
        return;
      }

      // ── 6. Step B: exact case-insensitive match ───────────────────────────────
      const fullText = sEl.textContent ?? "";
      const exactIdx = fullText.toLowerCase().indexOf(searchLower);
      if (exactIdx !== -1) {
        const range = buildRange(sEl, exactIdx, searchLower.length, (n) => (n.textContent ?? "").toLowerCase());
        if (range) { scrollToRange(range); return; }
      }

      // ── 7. Fuzzy range match via diff-match-patch ─────────────────────────────
      // Handles whitespace variants, markdown artifacts, and template placeholder
      // differences ([\] vs [ ]) between backend mammoth text and frontend DOM text.
      // Bitap limit: truncate pattern to Match_MaxBits (32) for location; full length for range.
      {
        const dmp = new diff_match_patch();
        dmp.Match_Threshold = 0.4;
        dmp.Match_Distance = 100000;
        const kwFull = searchKey.trim();
        const maxBits = dmp.Match_MaxBits || 32;
        const kwShort = kwFull.slice(0, maxBits);
        try {
          const dmpIdx = dmp.match_main(fullText, kwShort, 0);
          if (dmpIdx !== -1) {
            // Verify: use full length only if exact match confirmed at dmpIdx; else cap at kwShort.
            const textAtMatch = fullText.slice(dmpIdx);
            const useLen = textAtMatch.toLowerCase().startsWith(kwFull.toLowerCase())
              ? kwFull.length
              : kwShort.length;
            const range = buildRange(sEl, dmpIdx, useLen, (n) => n.textContent ?? "");
            if (range) { scrollToRange(range); return; }
          }
        } catch { /* guard */ }
      }

      // ── 8. Fallback: section top ──────────────────────────────────────────────
      sEl.scrollIntoView({ behavior: "smooth", block: "start" });
      sEl.style.transition = "background-color 0.3s";
      sEl.style.backgroundColor = "rgba(99,102,241,0.07)";
      setTimeout(() => { sEl.style.backgroundColor = ""; }, 1800);
  }, []);

  const handleQuickAction = useCallback(
    async (type: QuickActionType, userInstruction?: string): Promise<void> => {
      if (!jobId || !result) return;
      setQuickActionLoading(true);
      const snapshotResult = result;
      try {
        const _resp = await reviewApi.quickAction(jobId, type, userInstruction, additionalRequirements || undefined);
        // Persist user's instruction alongside the result for display when viewing old versions
        const resp = userInstruction?.trim()
          ? { ..._resp, userInstruction: userInstruction.trim() }
          : _resp;
        setQuickActionResult(resp);
        setActiveVersionNum(null);
        // Merge AI-suggested edits from quick action into the comparison edits list
        const mergedEdits = (() => {
          const existing = snapshotResult.comparison?.edits ?? [];
          const incoming = (resp.suggested_edits ?? []).map((se) => ({
            clause_name: se.clause_name,
            modified_text: se.modified_text,
            suggested_text: se.suggested_text,
            anchor_text: se.anchor_text ?? se.modified_text.slice(0, 40),
            reason: se.reason,
            risk_level: se.risk_level,
            verdict: "disagree" as const,
            is_quick_action: true,
            bilingual_modified_text: se.bilingual_modified_text ?? null,
            bilingual_suggested_text: se.bilingual_suggested_text ?? null,
            bilingual_anchor_text: se.bilingual_anchor_text ?? null,
          }));
          // Deduplicate: skip incoming edits whose modified_text already exists
          const existingKeys = new Set(existing.map((e) => e.modified_text));
          const newEdits = incoming.filter((e) => !existingKeys.has(e.modified_text));
          // Use a single timestamp so addedIds and newEditsWithId share the same IDs
          const ts = Date.now();
          const addedIds = new Set(newEdits.map((_, i) => `qa-${ts}-${i}`));
          const newEditsWithId = newEdits.map((e, i) => ({ ...e, id: `qa-${ts}-${i}` }));
          setNewEditIds(addedIds);
          // Auto-clear "Mới" badge after 5 minutes — cancel previous timer first
          if (newEditIdsClearTimerRef.current) clearTimeout(newEditIdsClearTimerRef.current);
          newEditIdsClearTimerRef.current = setTimeout(() => {
            setNewEditIds(new Set());
            newEditIdsClearTimerRef.current = null;
          }, 5 * 60 * 1000);
          return [...existing, ...newEditsWithId];
        })();
        const qResult: typeof snapshotResult = {
          ...snapshotResult,
          // Score stays unchanged — quick action adds suggestions only, not applied edits
          quickActionResult: resp,
          // When compare mode is off, result.comparison is null — still create a comparison
          // object so quick action suggested_edits are shown in the sidebar suggest tabs
          comparison: snapshotResult.comparison
            ? { ...snapshotResult.comparison, edits: mergedEdits as typeof snapshotResult.comparison.edits }
            : mergedEdits.length > 0
              ? { is_identical: false, differences: [], missingClauses: [], conflictTerms: [], edits: mergedEdits as NonNullable<typeof snapshotResult.comparison>["edits"] }
              : snapshotResult.comparison,
        };
        // Update live result so sidebar reflects merged edits immediately
        setResult(qResult);
        addSessionEvent(
          "quick_action",
          t("review.progress.eventQuickAction", {
            action: t(
              `review.analysis.quickAction${type.charAt(0).toUpperCase()}${type.slice(1)}`,
              { defaultValue: "" }
            ),
          })
        );
        // Sync history drawer — backend already updated row.risk_score in quick_action
        queryClient.invalidateQueries({ queryKey: ["review-history"] });
      } catch (err) {
        console.error(err);
        toast.error(t("review.history.quickActionFailed"));
      } finally {
        setQuickActionLoading(false);
      }
    },
    [jobId, result, reviewType, addSessionEvent, t, committedEdits, queryClient, additionalRequirements]
  );

  const handleDownloadDocx = useCallback(async () => {
    if (!jobId || !selectedDoc) return;
    setDownloadingDocx(true);
    const stem = selectedDoc.name.replace(/\.[^/.]+$/, "");
    try {
      await reviewApi.downloadTrackedChanges(jobId, `${stem}.docx`);
    } catch {
      toast.error(t("review.page.downloadDocxFailed"));
    } finally {
      setDownloadingDocx(false);
    }
  }, [jobId, selectedDoc, t]);

  const handleDownloadPdf = useCallback(async () => {
    if (!jobId || !selectedDoc) return;
    setDownloadingPdf(true);
    const stem = selectedDoc.name.replace(/\.[^/.]+$/, "");
    try {
      await reviewApi.downloadEvalReport(jobId, `${stem}.pdf`);
    } catch {
      toast.error(t("review.page.downloadPdfFailed"));
    } finally {
      setDownloadingPdf(false);
    }
  }, [jobId, selectedDoc, t]);



  // ── Save progress (sidebar button) ─────────────────────────────────────────

  // Ref to callback registered by RightAnalysisSidebar to scroll to a specific edit/checklist card
  const scrollToRefIdRef = useRef<((refId: string) => void) | null>(null);

  const handleHighlightRefClick = useCallback((refId: string) => {
    scrollToRefIdRef.current?.(refId);
  }, []);

  const handleSaveProgress = useCallback(async () => {
    if (!jobId || !result || isSavingProgress) return;
    if (saveEventsTimerRef.current) {
      clearTimeout(saveEventsTimerRef.current);
      saveEventsTimerRef.current = null;
    }

    const anchorJobId = versionAnchorJobIdRef.current ?? jobId;
    setIsSavingProgress(true);
    try {
      // Có pending edits → recalc + lưu version (persist để reopen được), nhưng KHÔNG move sang committed
      // Status vẫn là "reviewing" vì user chưa hoàn tất
      if (Object.keys(pendingEdits).length > 0) {
        const newCommitted = { ...committedEdits, ...pendingEdits };
        let savedScore = result.riskScore ?? 0;
        setIsRecalculating(true);
        try {
          const qaEdits = result.comparison?.edits?.filter((e) => e.is_quick_action || e.id?.startsWith("qa-")) || [];
          const resp = await reviewApi.recalculateScore(jobId, newCommitted, qaEdits);
          savedScore = resp.newScore;
          setResult((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              riskScore: resp.newScore,
              quickActionResult: prev.quickActionResult
                ? { ...prev.quickActionResult, newScore: resp.newScore }
                : undefined
            };
          });
          setQuickActionResult((prev) => prev ? { ...prev, newScore: resp.newScore } : null);
          if (resp.delta > 0) setScoreImprovement({ delta: resp.delta, summary: resp.summary });
        } catch { /* dùng điểm cũ */ } finally {
          setIsRecalculating(false);
        }
        sessionVersionCountRef.current += 1;
        const vNum = sessionVersionCountRef.current;
        const versionLabel = t("review.page.saveProgressVersionLabel", { defaultValue: "Tiến trình đã lưu" });
        const versionResult = {
          ...result,
          riskScore: savedScore,
          quickActionResult: result.quickActionResult
            ? { ...result.quickActionResult, newScore: savedScore }
            : undefined
        };
        await reviewApi.saveVersion(anchorJobId, {
          version_num: vNum,
          label: versionLabel,
          type: "apply_suggestion",
          score: savedScore,
          review_type: reviewType,
          result: versionResult,
          applied_edits: newCommitted,
        }).catch(console.error);
        setVersionHistory((prev) => [
          ...prev,
          { num: vNum, label: versionLabel, type: "apply_suggestion" as const, score: savedScore, reviewType, timestamp: new Date(), result: versionResult, appliedEdits: newCommitted },
        ]);
      }

      // Save session events
      if (sessionEvents.length > 0) {
        await reviewApi.saveSessionEvents(
          anchorJobId,
          sessionEvents.map((e) => ({
            id: e.id,
            type: e.type,
            label: e.label,
            timestamp: e.timestamp.toISOString(),
          }))
        ).catch(console.error);
      }

      // Lưu tiến trình → "reviewing" (= "Tiếp tục" trong drawer), không phải "completed"
      await reviewApi.updateStatus(anchorJobId, "reviewing");
      // Reset để handleSaveVersion sau này vẫn có thể mark completed
      jobMarkedCompletedRef.current = false;
      setHasBeenCompleted(true);

      await queryClient.invalidateQueries({ queryKey: ["review-history"] });
      toast.success(t("review.page.saveProgressSuccess"));
    } catch (err) {
      console.error(err);
      toast.error(t("review.page.saveProgressFailed"));
    } finally {
      setIsSavingProgress(false);
    }
  }, [
    jobId,
    result,
    isSavingProgress,
    pendingEdits,
    committedEdits,
    sessionEvents,
    reviewType,
    queryClient,
    t,
  ]);

  const handleDownloadDocxFromHistory = useCallback(
    async (item: ReviewHistoryItem) => {
      try {
        await reviewApi.downloadTrackedChanges(
          item.id,
          `${item.document_name}_legal_review.docx`
        );
      } catch {
        toast.error(t("review.history.downloadDocxFailed"));
      }
    },
    [t]
  );

  // ── Step navigation ───────────────────────────────────────────────────────
  const handleJumpStep = useCallback(
    (n: ReviewStep) => {
      if (n > maxStep) return;
      setStep(n);
    },
    [maxStep]
  );

  // ── Exit / reset ──────────────────────────────────────────────────────────
  const resetWorkflow = useCallback(() => {
    setStep(1);
    setMaxStep(1);
    setSelectedDoc(null);
    setCompareEnabled(false);
    setCompareDocIds([]);
    setReferenceEnabled(false);
    setReferenceDocIds([]);
    setReferenceContent("");
    setAdditionalRequirements("");
    setReviewType("Legal");
    setChecklist(buildChecklist("Legal"));
    setPendingReviewType(null);
    setUiState("empty");
    setResult(null);
    setJobId(null);
    versionAnchorJobIdRef.current = null;
    sessionVersionCountRef.current = 0;
    jobMarkedCompletedRef.current = false;
    setHasBeenCompleted(false);
    setDisplayScore(0);
    setCompareMode(null);
    setSections([]);
    setTemplateSections([]);
    setViewingTemplate(false);
    setActiveFix(null);
    setIgnoredFixes(new Set());
    setAppliedFixes({});
    setPendingEdits({});
    setCommittedEdits({});
    setIgnoredEditIds(new Set());
    setQuickActionResult(null);
    setSessionEvents([]);
    setCheckedItemIds(new Set());
    setVersionHistory([]);
    setActiveVersionNum(null);
    prevVersionLengthRef.current = 0;
    restoringVersionsRef.current = false;
    if (saveEventsTimerRef.current) clearTimeout(saveEventsTimerRef.current);
    reviewCountRef.current = 0;
    fixCountRef.current = 0;
    docReadyRef.current = false;
    docReadyRef.current = false;
    suggestTriggeredRef.current = null;
    setAiSuggestedIds(null);
  }, []);

  const handleTriggerAiSuggest = useCallback(() => {
    suggestTriggeredRef.current = null;
    setSuggestRetryTick((c) => c + 1);
  }, []);

  // Đã lưu tiến trình = đã nhấn "Lưu tiến trình" hoặc đã Apply ít nhất 1 lần
  const progressSaved = hasBeenCompleted;
  // Hỏi trước khi thoát chỉ khi chưa từng lưu (1 lần duy nhất)
  const needsExitConfirm = result !== null && !hasBeenCompleted;

  const handleExitClick = useCallback(() => {
    if (!selectedDoc) return;
    if (needsExitConfirm) {
      setExitConfirmOpen(true);
    } else {
      resetWorkflow();
    }
  }, [selectedDoc, needsExitConfirm, resetWorkflow]);

  // ── Derived values ────────────────────────────────────────────────────────
  const compareActive = useMemo(
    () => compareEnabled && compareDocIds.length > 0,
    [compareEnabled, compareDocIds]
  );

  const referenceActive = useMemo(
    () => referenceEnabled && referenceDocIds.length > 0,
    [referenceEnabled, referenceDocIds]
  );

  const templateDocName = useMemo(
    () => documents.find((d) => d.id === primaryCompareDocId)?.name ?? null,
    [documents, primaryCompareDocId]
  );

  // ── All documents list for name lookup (compare + reference) ─────────────
  const allKnownDocs: ReviewDocItem[] = useMemo(() => documents, [documents]);

  const compareFileNames = useMemo(
    () => compareActive ? compareDocIds.map((id) => documents.find((d) => d.id === id)?.name ?? id) : [],
    [compareActive, compareDocIds, documents]
  );

  const refDocFileNames = useMemo(
    () => referenceActive ? referenceDocIds.map((id) => documents.find((d) => d.id === id)?.name ?? id) : [],
    [referenceActive, referenceDocIds, documents]
  );

  const latestVersionNum = versionHistory.length > 0 ? versionHistory[versionHistory.length - 1].num : null;
  const isViewingHistoryVersion = activeVersionNum !== null && activeVersionNum !== undefined
    && latestVersionNum !== null && activeVersionNum !== latestVersionNum;

  // History view: show that version's committed edits (readonly); current view: live committed + pending
  const sidebarCommittedEdits = useMemo(() => {
    if (isViewingHistoryVersion) {
      const histVersion = versionHistory.find((v) => v.num === activeVersionNum);
      return histVersion?.appliedEdits ?? {};
    }
    return committedEdits;
  }, [isViewingHistoryVersion, activeVersionNum, versionHistory, committedEdits]);

  // Document viewer gets union of committed + pending so user sees all changes in context
  const docViewerAppliedEdits = useMemo(
    () => isViewingHistoryVersion ? sidebarCommittedEdits : { ...committedEdits, ...pendingEdits },
    [isViewingHistoryVersion, sidebarCommittedEdits, committedEdits, pendingEdits]
  );

  const checklistGrouped = useMemo<ChecklistGroupResult[]>(() => {
    if (!result) return [];
    const sourceItems =
      reviewType === "Custom" ? ALL_REVIEW_CHECKLIST_ITEMS : REVIEW_CHECKLISTS[reviewType];
    const idToCategory = new Map(
      sourceItems.map((item) => [item.id, item.category ?? "Khác"])
    );
    const groups = new Map<string, typeof result.checklist>();
    for (const item of result.checklist) {
      // Chỉ hiển thị các mục checklist mà người dùng đã tick ở Bước 2
      if (checkedItemIds.size > 0 && !checkedItemIds.has(item.id)) continue;
      const category = idToCategory.get(item.id) ?? "Khác";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push(item);
    }
    return Array.from(groups.entries()).map(([groupLabel, items]) => ({ groupLabel, items }));
  }, [result, reviewType, checkedItemIds]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">

      {/* ── Mode-change confirm dialog ─────────────────────────────────────────── */}
      <AlertDialog
        open={pendingReviewType !== null}
        onOpenChange={(open) => { if (!open) setPendingReviewType(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("review.page.changeReviewTypeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("review.page.changeReviewTypeDesc", { type: pendingReviewType })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingReviewType(null)}>{t("review.page.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-muted text-foreground hover:bg-muted/80 border-border border"
              onClick={() => {
                if (pendingReviewType) setReviewType(pendingReviewType);
                setPendingReviewType(null);
              }}
            >
              {t("review.page.keepChecklist")}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (pendingReviewType) {
                  setReviewType(pendingReviewType);
                  setChecklist(buildChecklist(pendingReviewType));
                  setAiSuggestedIds(null);
                }
                setPendingReviewType(null);
              }}
            >
              {t("review.page.resetToDefault")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Exit confirm dialog ────────────────────────────────────────────── */}
      <Dialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("review.page.exitConfirmTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("review.page.exitConfirmDesc")}
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => {
              setExitConfirmOpen(false);
              // Dialog chỉ mở khi !hasBeenCompleted → luôn xóa job để không spam in_progress
              // Dùng anchorJobId vì versions được lưu dưới job đó
              const deleteId = versionAnchorJobIdRef.current ?? jobId;
              if (deleteId) {
                reviewApi.deleteHistoryItem(deleteId)
                  .then(() => queryClient.invalidateQueries({ queryKey: ["review-history"] }))
                  .catch(() => {});
              }
              resetWorkflow();
            }}>
              {t("review.page.exitWithoutSave")}
            </Button>
            <Button variant="ghost" onClick={() => setExitConfirmOpen(false)}>{t("review.page.cancel")}</Button>
            <Button
              className="gap-2"
              onClick={async () => {
                setExitConfirmOpen(false);
                await handleSaveProgress();
                resetWorkflow();
              }}
            >
              <Save className="w-4 h-4" /> {t("review.analysis.saveProgress")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Drawers ────────────────────────────────────────────────────────── */}
      <ReviewedHistoryDrawer
        open={myDocsOpen}
        onClose={() => setMyDocsOpen(false)}
        records={historyResp?.items ?? []}
        loading={historyLoading}
        onContinue={(item) => { handleReopenHistory(item); setMyDocsOpen(false); }}
        onDelete={(item) => deleteHistoryMutation.mutate(item.id)}
        onDownloadDocx={handleDownloadDocxFromHistory}
      />
      <ProgressHistoryDrawer
        open={progressHistoryOpen}
        onClose={() => setProgressHistoryOpen(false)}
        events={sessionEvents}
      />

      {/* ── File pickers ───────────────────────────────────────────────────── */}
      <FilePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={t("review.page.pickerTitle")}
        onConfirm={handleMainFilePicked}
      />
      <FilePicker
        open={comparePickerOpen}
        onOpenChange={setComparePickerOpen}
        title={t("review.page.pickerTitleCompare")}
        multi
        excludeIds={selectedDoc ? [selectedDoc.id, ...compareDocIds] : compareDocIds}
        onConfirm={handleCompareFilePicked}
      />
      <FilePicker
        open={referencePickerOpen}
        onOpenChange={setReferencePickerOpen}
        title={t("review.page.pickerTitleReference")}
        multi
        excludeIds={selectedDoc ? [selectedDoc.id, ...referenceDocIds] : referenceDocIds}
        onConfirm={handleReferenceFilePicked}
      />

      {/* ── TOP BAR ────────────────────────────────────────────────────────── */}
      <div className="border-b border-border/70 bg-background px-5 py-3 flex items-center gap-3 flex-shrink-0">
        {/* Thoát button — hiện khi có file */}
        {selectedDoc && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground flex-shrink-0 -ml-1"
            onClick={handleExitClick}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> {t("review.page.exitButton")}
          </Button>
        )}

        {/* Icon + title */}
        <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
          <FileSearch className="w-4 h-4 text-brand-600" />
        </div>
        <div className="min-w-0 mr-1">
          <h1 className="text-sm font-semibold text-foreground leading-tight">
            {t("review.page.title")}
          </h1>
          <p className="text-xs text-muted-foreground truncate">
            {selectedDoc ? selectedDoc.name : t("review.page.subtitle")}
          </p>
        </div>

        {/* Horizontal step bar — centered */}
        <div className="flex-1 flex justify-center">
          <HorizontalStepBar
            current={step}
            maxReached={maxStep}
            onJump={handleJumpStep}
          />
        </div>

        {/* Context-aware right buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {!selectedDoc && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setMyDocsOpen(true)}
            >
              <FileText className="w-3.5 h-3.5" /> {t("review.page.myDocsButton")}
            </Button>
          )}
          {selectedDoc && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setProgressHistoryOpen(true)}
            >
              <History className="w-3.5 h-3.5" /> {t("review.page.progressHistoryButton")}
            </Button>
          )}
        </div>
      </div>

      {/* ── BODY: CENTER + RIGHT ────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* CENTER — khớp design: ONE ScrollArea duy nhất khi có file */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {!selectedDoc || step === 1 ? (
            /* Step 1: empty state */
            <EmptyChoose onOpen={() => setPickerOpen(true)} />
          ) : (
            <ScrollArea className="flex-1 min-h-[600px]">
              <div className="p-6 max-w-5xl  mx-auto">
                <FileScanCard
                  doc={selectedDoc}
                  pages={
                    (docTextResp?.page_count != null && docTextResp.page_count > 0)
                      ? docTextResp.page_count
                      : (docTextResp?.text ? Math.max(1, Math.ceil(docTextResp.text.length / 2200)) : undefined)
                  }
                />

                {step === 3 ? (
                  <CenterDocViewer
                    docName={selectedDoc.name}
                    documentId={selectedDoc.id}
                    templateName={templateDocName}
                    sections={sections}
                    templateSections={templateSections}
                    viewingTemplate={viewingTemplate}
                    setViewingTemplate={setViewingTemplate}
                    compareActive={compareActive}
                    referenceActive={referenceActive}
                    highlights={(result?.highlights ?? []).filter((h) => {
                      if (h.highlight_type === "compare") return compareActive;
                      if (h.highlight_type === "reference") return referenceActive;
                      return true;
                    })}
                    appliedFixes={appliedFixes}
                    appliedEdits={docViewerAppliedEdits}
                    sectionRefs={sectionRefs}
                    hasResult={uiState === "success"}
                    reviewType={reviewType}
                    onHighlightRefClick={handleHighlightRefClick}
                  />
                ) : (
                  /* ── Step 2: formatted preview (mammoth cho DOCX, plain text fallback) ── */
                  <CenterDocViewer
                    docName={selectedDoc.name}
                    documentId={selectedDoc.id}
                    sections={sections}
                    templateSections={[]}
                    viewingTemplate={false}
                    setViewingTemplate={() => {}}
                    compareActive={false}
                    highlights={[]}
                    appliedFixes={{}}
                    sectionRefs={sectionRefs}
                  />
                )}
              </div>
            </ScrollArea>
          )}

        </main>

        {/* RIGHT — chỉ hiện khi đã chọn file */}
        {selectedDoc && (
          <aside className="w-[clamp(320px,28vw,420px)] border-l border-border bg-card flex flex-col flex-shrink-0 overflow-hidden">
            {step === 2 && (
              <RightStep2Config
                reviewType={reviewType}
                onReviewTypeChange={handleReviewTypeChange}
                compareEnabled={compareEnabled}
                setCompareEnabled={setCompareEnabled}
                compareDocIds={compareDocIds}
                setCompareDocIds={setCompareDocIds}
                onOpenCompareFilePicker={() => setComparePickerOpen(true)}
                referenceEnabled={referenceEnabled}
                setReferenceEnabled={setReferenceEnabled}
                referenceDocIds={referenceDocIds}
                setReferenceDocIds={setReferenceDocIds}
                referenceContent={referenceContent}
                setReferenceContent={setReferenceContent}
                onOpenReferenceFilePicker={() => setReferencePickerOpen(true)}
                checklist={checklist}
                toggleChecklistItem={toggleChecklistItem}
                toggleCategoryItems={toggleCategoryItems}
                resetChecklistToAi={resetChecklistToAi}
                hasAiSuggestion={aiSuggestedIds !== null}
                selectAllChecklist={selectAllChecklist}
                clearAllChecklist={clearAllChecklist}
                additionalRequirements={additionalRequirements}
                setAdditionalRequirements={setAdditionalRequirements}
                isReviewing={uiState === "loading"}
                suggestingChecklist={suggestingChecklist}
                onTriggerAiSuggest={handleTriggerAiSuggest}
                onStartReview={handleRunReview}
                documents={allKnownDocs}
              />
            )}
            {step === 3 && (
              <RightAnalysisSidebar
                uiState={uiState}
                result={sidebarResult}
                displayScore={displayScore}
                activeFix={activeFix}
                setActiveFix={setActiveFix}
                ignoredFixes={ignoredFixes}
                addIgnoredFix={handleIgnoreFix}
                appliedFixes={appliedFixes}
                applyFix={handleApplyFix}
                quickActionResult={activeVersionNum === null ? quickActionResult : (sidebarResult?.quickActionResult ?? null)}
                quickActionLoading={quickActionLoading}
                onQuickAction={handleQuickAction}
                dismissQuickAction={() => {
                  setQuickActionResult(null);
                  setNewEditIds(new Set());
                  if (newEditIdsClearTimerRef.current) { clearTimeout(newEditIdsClearTimerRef.current); newEditIdsClearTimerRef.current = null; }
                  setResult((r) => r ? { ...r, quickActionResult: undefined } : r);
                }}
                onAnchorClick={handleAnchorClick}
                compareMode={compareMode}
                revisionsDetected={revisionsDetected}
                onDownloadDocx={handleDownloadDocx}
                onDownloadPdf={handleDownloadPdf}
                downloadingDocx={downloadingDocx}
                downloadingPdf={downloadingPdf}
                committedEdits={sidebarCommittedEdits}
                pendingEdits={isViewingHistoryVersion ? undefined : pendingEdits}
                ignoredEditIds={ignoredEditIds}
                onApplyEdit={isViewingHistoryVersion ? undefined : handleApplyEdit}
                onApplyAllEdits={isViewingHistoryVersion ? undefined : handleApplyAllEdits}
                onUndoEdit={isViewingHistoryVersion ? undefined : handleUndoEdit}
                onIgnoreEdit={isViewingHistoryVersion ? undefined : handleIgnoreEdit}
                onSaveVersion={isViewingHistoryVersion ? undefined : handleSaveVersion}
                hasComparisonEdits={(result?.comparison?.edits?.length ?? 0) > 0}
                onMarkCompleted={jobId ? handleSaveProgress : undefined}
                markingCompleted={isSavingProgress}
                progressSaved={progressSaved}
                docName={selectedDoc.name}
                docDate={selectedDoc.date ?? null}
                reviewType={reviewType}
                version={versionHistory.length || 1}
                compareFileNames={compareFileNames}
                refDocFileNames={refDocFileNames}
                refNote={referenceContent}
                checklistGrouped={activeVersionNum === null ? checklistGrouped : undefined}
                versionHistory={versionHistory}
activeVersionNum={activeVersionNum}
                onSwitchVersion={handleSwitchVersion}
                onRestoreVersion={handleRestoreVersion}
                additionalRequirements={additionalRequirements || undefined}
                newEditIds={newEditIds.size > 0 ? newEditIds : undefined}
                isRecalculating={isRecalculating}
                scoreImprovement={scoreImprovement}
                onRegisterScrollToRef={(fn) => { scrollToRefIdRef.current = fn; }}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
