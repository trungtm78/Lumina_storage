import { useState, useEffect, useRef } from "react";
import {
  ShieldCheck, GitBranch, FileText, ListChecks, AlertCircle,
  CheckCircle2, Sparkles, CircleDot, X, GitCompare, BookOpen, FileDown, ScrollText, Database,
  FileSearch, Loader2, Save, Send, AlertTriangle, RefreshCw, Check, History, RotateCcw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  AnalysisResult,
  ChecklistResult,
  EditEvaluation,
  KeyInfoItem,
  QuickActionResult,
  QuickActionType,
  ReferenceResult,
  RiskLevelEdit,
} from "@/app/api/endpoints/review";
import { cn } from "@/app/components/ui/utils";
import { Button } from "@/app/components/ui/button";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { Textarea } from "@/app/components/ui/textarea";

type UIState = "empty" | "loading" | "success";
type DisplaySuggestMode = "improve" | "reduce" | "rewrite";

export interface ChecklistGroupResult {
  groupLabel: string;
  items: ChecklistResult[];
}

export interface VersionEntry {
  id?: string;
  num: number;
  label: string;
  type: "ai_review" | "apply_suggestion" | "ai_request" | "user_edit" | "ai_generated_clause" | "restore";
  score: number;
  reviewType?: string;
  timestamp: Date;
  result: AnalysisResult;
  appliedEdits?: Record<string, { suggested: string; riskLevel: string; clauseName?: string }>;
}

// ─── Local design-aligned components ─────────────────────────────────────────

function ResultCard({
  icon: Icon,
  title,
  children,
  badge,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-primary" />
        <h3 className="text-[13px] font-bold text-foreground tracking-tight flex-1">{title}</h3>
        {badge}
      </div>
      {children}
    </div>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(
      "text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-medium",
      className
    )}>
      {children}
    </span>
  );
}

const KEY_INFO_GROUP_KEY: Record<string, string> = {
  "Parties":             "parties",
  "Legal Representative":"legalRepresentative",
  "Financial":           "financial",
  "Payment":             "payment",
  "Timeline":            "timeline",
  "Penalty":             "penalty",
  "Termination":         "termination",
  "Jurisdiction":        "jurisdiction",
  "Confidentiality":     "confidentiality",
  "Liability":           "liability",
};

function KeyInfoRow({ item }: { item: KeyInfoItem }) {
  const { t } = useTranslation();
  const hasValue = item.value !== null && item.value !== "" && item.value !== undefined;
  const subKey = KEY_INFO_GROUP_KEY[item.group];
  const label = subKey ? String(t(`review.analysis.keyInfo.${subKey}` as never)) : item.group;
  return (
    <div className="grid grid-cols-5 gap-2 px-1 py-1.5 text-[12.5px]">
      <div className="col-span-2 text-muted-foreground font-medium">{label}</div>
      <div className={cn("col-span-3", hasValue ? "text-foreground" : "text-muted-foreground/60 italic")}>
        {hasValue ? item.value : t("review.analysis.notFound")}
      </div>
    </div>
  );
}

function resolveChecklistStatus(c: ChecklistResult): "pass" | "warning" | "risk" {
  if (c.status) return c.status;
  return c.passed ? "pass" : "risk";
}

function ChecklistItemRow({
  c,
  onAnchorClick,
}: {
  c: ChecklistResult;
  onAnchorClick: (keyword: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const status = resolveChecklistStatus(c);
  const itemLabel = c.id
    ? String(t(`review.checklist.${c.id}.label` as never, { defaultValue: c.label }))
    : c.label;
  const isLongNote = !!c.note && c.note.length > 180;
  const iconColor =
    status === "pass"
      ? "text-emerald-500"
      : status === "warning"
      ? "text-amber-500"
      : "text-red-500";
  return (
    <li>
      <div className="flex gap-2 items-start">
        <button
          onClick={() => c.anchorKeyword && onAnchorClick(c.anchorKeyword)}
          className="flex gap-2 items-start w-full text-left hover:opacity-75 transition-opacity"
        >
          {status === "pass" && <CheckCircle2 className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", iconColor)} />}
          {status === "warning" && <AlertTriangle className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", iconColor)} />}
          {status === "risk" && <AlertCircle className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", iconColor)} />}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight mb-0.5">
              {itemLabel}
            </p>
            {c.note && (
              <p className={cn("text-[12px] leading-snug text-foreground", !expanded && isLongNote && "line-clamp-3")}>
                {c.note}
              </p>
            )}
          </div>
        </button>
      </div>
      {isLongNote && (
        <button
          className="ml-5 mt-0.5 text-[11px] text-primary hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t("review.analysis.collapseNote") : t("review.analysis.expandNote")}
        </button>
      )}
    </li>
  );
}


// ─── Props ────────────────────────────────────────────────────────────────────

export interface RightAnalysisSidebarProps {
  uiState: UIState;
  result: AnalysisResult | null;
  displayScore: number;

  activeFix: number | null;
  setActiveFix: (v: number | null) => void;
  ignoredFixes: Set<number>;
  addIgnoredFix: (idx: number) => void;
  appliedFixes: Record<string, string>;
  applyFix: (issueKeyword: string, text: string) => void;

  quickActionResult: QuickActionResult | null;
  quickActionLoading: boolean;
  onQuickAction: (type: QuickActionType, userInstruction?: string) => Promise<void>;
  dismissQuickAction: () => void;
  /** Context từ Step 2 — hiện chip nhắc nhở trong Step 3 */
  additionalRequirements?: string;
  /** IDs của edits vừa được thêm bởi quick action — hiện badge "Mới" */
  newEditIds?: Set<string>;

  onAnchorClick: (keyword: string) => void;

  compareMode?: "tracked" | "semantic" | null;
  revisionsDetected?: { document: number; template: number };

  onDownloadDocx?: () => void;
  onDownloadPdf?: () => void;
  downloadingDocx?: boolean;
  downloadingPdf?: boolean;
  /** true khi result.comparison.edits có ít nhất 1 mục — dùng để hiển thị label phù hợp */
  hasComparisonEdits?: boolean;

  /** Edits đã committed vào version — checkbox locked, không thể untick */
  committedEdits?: Record<string, { suggested: string; riskLevel: RiskLevelEdit | string }>;
  /** Edits đang pending (ticked, chưa Apply) — checkbox active, có thể untick */
  pendingEdits?: Record<string, { suggested: string; riskLevel: RiskLevelEdit | string }>;
  ignoredEditIds?: Set<string>;
  onApplyEdit?: (editId: string, modifiedText: string, suggested: string, riskLevel: string, clauseName?: string, bilingualModifiedText?: string | null, bilingualSuggestedText?: string | null) => void;
  onApplyAllEdits?: (edits: Array<{ id: string; modifiedText: string; suggested: string; riskLevel: string; clauseName: string; bilingualModifiedText?: string | null; bilingualSuggestedText?: string | null }>) => void;
  onUndoEdit?: (modifiedText: string, bilingualModifiedText?: string | null) => void;
  onIgnoreEdit?: (editId: string) => void;
  onSaveVersion?: (label?: string, editsToSave?: Record<string, { suggested: string; riskLevel: RiskLevelEdit | string; clauseName?: string }>) => void;
  onMarkCompleted?: () => void;
  markingCompleted?: boolean;
  isRecalculating?: boolean;
  scoreImprovement?: { delta: number; summary: string } | null;
  progressSaved?: boolean;

  docName?: string | null;
  docDate?: string | null;
  reviewType?: string | null;
  className?: string;

  version?: number;
  compareFileNames?: string[];
  refDocFileNames?: string[];
  refNote?: string;
  checklistGrouped?: ChecklistGroupResult[];
  versionHistory?: VersionEntry[];
  activeVersionNum?: number | null;
  onSwitchVersion?: (num: number | null) => void;
  onRestoreVersion?: (num: number) => void;
  /** Parent truyền vào để đăng ký callback scroll-to-edit — gọi với edit/checklist id */
  onRegisterScrollToRef?: (fn: (refId: string) => void) => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RightAnalysisSidebar(props: RightAnalysisSidebarProps) {
  const {
    uiState, result, displayScore,
    quickActionResult, quickActionLoading, onQuickAction, dismissQuickAction,
    additionalRequirements, newEditIds,
    onAnchorClick, compareMode, revisionsDetected,
    onDownloadDocx, onDownloadPdf, downloadingDocx, downloadingPdf, hasComparisonEdits,
    onMarkCompleted, markingCompleted, isRecalculating, progressSaved,
    docName, docDate, reviewType, className,
    version, compareFileNames, refDocFileNames, refNote, checklistGrouped,
    versionHistory, activeVersionNum, onSwitchVersion, onRestoreVersion,
    committedEdits, pendingEdits, ignoredEditIds, onApplyEdit, onApplyAllEdits, onUndoEdit, onIgnoreEdit, onSaveVersion,
    onRegisterScrollToRef,
  } = props;

  const { t } = useTranslation();
  const [tab, setTab] = useState<"review" | "version">("review");
  const [suggestMode, setSuggestMode] = useState<DisplaySuggestMode | null>(null);
  const editCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [dismissedSugg, setDismissedSugg] = useState<Record<DisplaySuggestMode, Set<number>>>({
    improve: new Set(), reduce: new Set(), rewrite: new Set(),
  });
  const [loopInput, setLoopInput] = useState("");
  const [lastInstruction, setLastInstruction] = useState("");
  const [resultExpanded, setResultExpanded] = useState(false);

  // Sync: khi quickActionResult bị clear từ parent (dismiss hoặc version switch), reset local state
  useEffect(() => {
    if (!quickActionResult) {
      setLastInstruction("");
      setResultExpanded(false);
    }
  }, [quickActionResult]);
  const [unseenVersionCount, setUnseenVersionCount] = useState(0);
  const [contextExpanded, setContextExpanded] = useState(false);
  const prevVersionLenRef = useRef(versionHistory?.length ?? 0);
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());

  useEffect(() => {
    const current = versionHistory?.length ?? 0;
    if (current > prevVersionLenRef.current && tab !== "version") {
      setUnseenVersionCount((c) => c + (current - prevVersionLenRef.current));
    }
    prevVersionLenRef.current = current;
  }, [versionHistory?.length, tab]);


  // Đăng ký scroll-to-ref callback để parent (DocumentReviewPage) có thể trigger
  useEffect(() => {
    if (!onRegisterScrollToRef) return;
    onRegisterScrollToRef((refId: string) => {
      const el = editCardRefs.current[refId];
      if (!el) return;
      // Switch sang tab "review" nếu đang ở tab khác
      setTab("review");
      // Scroll el vào view sau khi tab render
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline = "2px solid rgba(99,102,241,0.6)";
        el.style.borderRadius = "8px";
        setTimeout(() => { el.style.outline = ""; el.style.borderRadius = ""; }, 1500);
      });
    });
  }, [onRegisterScrollToRef]);

  // ── Empty ────────────────────────────────────────────────────────────────────
  if (uiState === "empty" || !result) {
    return (
      <div className={cn("flex flex-col h-full w-full", className)}>
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <FileSearch className="h-10 w-10 opacity-30" />
          <div className="text-sm">
            {t("review.analysis.emptyHint")}{" "}
            <span className="text-foreground font-medium">{t("review.analysis.emptyHintAction")}</span>.
          </div>
          <div className="text-[13px]">{t("review.analysis.emptyResult")}</div>
        </div>
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (uiState === "loading") {
    return (
      <div className={cn("flex flex-col h-full w-full", className)}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
          <Loader2 className="text-primary h-8 w-8 animate-spin" />
          <div className="text-sm font-medium">{t("review.analysis.aiAnalyzing")}</div>
          <div className="text-muted-foreground text-center text-[13px]">{t("review.analysis.aiAnalyzingDetail")}</div>
        </div>
      </div>
    );
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const currentScore = quickActionResult ? quickActionResult.newScore : displayScore;

  // const appliedEditsCount = Object.keys(committedEdits ?? {}).length + Object.keys(pendingEdits ?? {}).length;
  // const pendingEditsCount = result.comparison?.edits
  //   ? result.comparison.edits.filter(
  //       (e: EditEvaluation) =>
  //         e.suggested_text?.trim() &&
  //         !ignoredEditIds?.has(e.id) &&
  //         !pendingEdits?.[e.modified_text] &&
  //         !committedEdits?.[e.modified_text]
  //     ).length
  //   : 0;
  const versionNum = version ?? 1;

  const riskLabel =
    currentScore >= 81 ? t("review.analysis.riskVeryHigh") :
    currentScore >= 61 ? t("review.analysis.riskHighFull") :
    currentScore >= 41 ? t("review.analysis.riskMediumFull") :
    currentScore >= 21 ? t("review.analysis.riskLowFull") : t("review.analysis.riskSafe");

  const riskTone =
    currentScore >= 81 ? "text-red-600 bg-red-50 border-red-200" :
    currentScore >= 61 ? "text-orange-600 bg-orange-50 border-orange-200" :
    currentScore >= 41 ? "text-amber-700 bg-amber-50 border-amber-200" :
    currentScore >= 21 ? "text-yellow-700 bg-yellow-50 border-yellow-200" :
    "text-emerald-700 bg-emerald-50 border-emerald-200";

  const ext = docName?.split(".").pop()?.toUpperCase() ?? "DOC";
  const latestVersionNum = versionHistory && versionHistory.length > 0
    ? versionHistory[versionHistory.length - 1].num
    : null;
  const isViewingHistory = activeVersionNum !== null && activeVersionNum !== undefined
    && latestVersionNum !== null && activeVersionNum !== latestVersionNum;

  // Tính badge từ các item đang hiển thị (đã lọc qua checklistGrouped)
  const allDisplayedItems = (checklistGrouped && checklistGrouped.length > 0)
    ? checklistGrouped.flatMap((g) => g.items)
    : result.checklist;
  const passCount = allDisplayedItems.filter((c) => resolveChecklistStatus(c) === "pass").length;
  const warnCount = allDisplayedItems.filter((c) => resolveChecklistStatus(c) === "warning").length;
  const failCount = allDisplayedItems.filter((c) => resolveChecklistStatus(c) === "risk").length;

  const SUGGEST_MODES: { key: DisplaySuggestMode; label: string }[] = [
    { key: "improve", label: t("review.analysis.suggestModeImprove") },
    { key: "reduce", label: t("review.analysis.suggestModeReduce") },
    { key: "rewrite", label: t("review.analysis.suggestModeRewrite") },
  ];

  // EditEvaluation cards lọc theo từng tab
  // Ưu tiên suggestion_category từ backend; fallback heuristic nếu thiếu
  const allEdits = result.comparison?.edits ?? [];
  const resolveCategory = (e: EditEvaluation): "improve" | "reduce" | "rewrite" => {
    if (e.suggestion_category) return e.suggestion_category;
    return e.risk_level === "high" ? "rewrite" : e.risk_level === "medium" ? "reduce" : "improve";
  };
  const editsByMode: Record<DisplaySuggestMode, EditEvaluation[]> = {
    improve: allEdits.filter(e => e.suggested_text?.trim() && !ignoredEditIds?.has(e.id) && resolveCategory(e) === "improve"),
    reduce:  allEdits.filter(e => e.suggested_text?.trim() && !ignoredEditIds?.has(e.id) && resolveCategory(e) === "reduce"),
    rewrite: allEdits.filter(e => e.suggested_text?.trim() && !ignoredEditIds?.has(e.id) && resolveCategory(e) === "rewrite"),
  };

  // Fallback text khi không có edits
  const suggestContent: Record<DisplaySuggestMode, string[]> = {
    improve: result.suggestions.slice(0, 5),
    reduce: result.fixes.slice(0, 5).map((f) => f.suggestion),
    rewrite: result.keyIssues.slice(0, 3).map((i) => `${t("review.analysis.rewritePrefix")}${i}`),
  };

  const handleDismissSugg = (mode: DisplaySuggestMode, idx: number) => {
    setDismissedSugg((prev) => ({
      ...prev,
      [mode]: new Set([...Array.from(prev[mode]), idx]),
    }));
  };

  const SUGGEST_MODE_LABELS: Record<DisplaySuggestMode, string> = {
    improve: t("review.analysis.suggestModeImprove"),
    reduce:  t("review.analysis.suggestModeReduce"),
    rewrite: t("review.analysis.suggestModeRewrite"),
  };

  // Tick tất cả chưa được tick/commit trong tab hiện tại (thêm vào pending)
  const handleApplyAllInTab = () => {
    if (!suggestMode || !onApplyAllEdits) return;
    const toApply = editsByMode[suggestMode]
      .filter((e: EditEvaluation) => !pendingEdits?.[e.modified_text] && !committedEdits?.[e.modified_text])
      .map((e: EditEvaluation) => ({
        id: e.id,
        modifiedText: e.modified_text,
        suggested: e.suggested_text,
        riskLevel: e.risk_level,
        clauseName: e.clause_name,
        bilingualModifiedText: e.bilingual_modified_text,
        bilingualSuggestedText: e.bilingual_suggested_text,
      }));
    if (toApply.length > 0) {
      onApplyAllEdits(toApply);
    }
  };

  // Bỏ tick tất cả pending trong tab hiện tại (không thể bỏ committed)
  const handleUndoAllInTab = () => {
    if (!suggestMode) return;
    editsByMode[suggestMode]
      .filter((e: EditEvaluation) => !!pendingEdits?.[e.modified_text])
      .forEach((e: EditEvaluation) => onUndoEdit?.(e.modified_text, e.bilingual_modified_text));
  };

  const handleLoopSubmit = () => {
    if (!loopInput.trim() || quickActionLoading) return;
    const instruction = loopInput.trim();
    setLoopInput("");
    setLastInstruction(instruction);
    setResultExpanded(false);
    onQuickAction("improve", instruction).catch(() => {
      setLoopInput(instruction);
    });
  };

  // ── Success ──────────────────────────────────────────────────────────────────
  return (
    <div className={cn("flex flex-col h-full w-full", className)}>

      {/* Header — Bước 3 · v{n} */}
      <div className="px-5 py-3.5 border-b border-border flex items-center gap-3 flex-shrink-0">
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
          <ShieldCheck className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            {t("review.analysis.stepThree")}
          </p>
          <p className="text-sm font-semibold text-foreground leading-tight">{t("review.analysis.resultTitle")}</p>
        </div>
        <span className="ml-auto flex-shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          v{versionNum}
        </span>
      </div>

      {/* Tab switcher */}
      <div className="px-3 pt-2 pb-2 border-b border-border flex-shrink-0">
        <div className="grid grid-cols-2 gap-1 p-0.5 rounded-md bg-muted/60">
          {([
            { k: "review", label: t("review.analysis.tabReview"), icon: ShieldCheck },
            { k: "version", label: t("review.analysis.tabVersion"), icon: GitBranch },
          ] as const).map((tb) => {
            const Icon = tb.icon;
            const active = tab === tb.k;
            return (
              <button
                key={tb.k}
                onClick={() => {
                  setTab(tb.k);
                  if (tb.k === "version") setUnseenVersionCount(0);
                }}
                className={cn(
                  "h-7 rounded text-[12px] font-medium flex items-center justify-center gap-1.5 transition relative",
                  active
                    ? "bg-card text-foreground shadow-sm border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tb.label}
                {tb.k === "version" && unseenVersionCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                    {unseenVersionCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">

        {/* ── Review tab ────────────────────────────────────────────────────── */}
        {tab === "review" && (
          <div className="px-4 py-3 space-y-3">

            {/* Banner khi đang xem version cũ */}
            {isViewingHistory && activeVersionNum && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-2">
                <div className="flex items-center gap-2">
                  <History className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                  <p className="text-[12px] text-amber-800 flex-1">
                    {t("review.analysis.viewingVersion")} <strong>v{activeVersionNum}</strong>
                  </p>
                  <button
                    onClick={() => onSwitchVersion?.(null)}
                    className="text-[11px] font-semibold text-amber-700 underline hover:text-amber-900 flex-shrink-0"
                  >
                    {t("review.analysis.viewCurrent")}
                  </button>
                </div>
                {onRestoreVersion && (
                  <button
                    onClick={() => onRestoreVersion(activeVersionNum)}
                    className="w-full flex items-center justify-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 py-1.5 text-[11.5px] font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {t("review.analysis.restoreVersion", { n: activeVersionNum })}
                  </button>
                )}
              </div>
            )}

            {/* Hướng dẫn từ Step 2 — compact, không lấn át kết quả */}
            {additionalRequirements && !isViewingHistory && (
              <button
                className="w-full text-left flex items-start gap-1.5 border-l-2 border-blue-300 pl-2.5 py-0.5 group"
                onClick={() => setContextExpanded((v) => !v)}
              >
                <BookOpen className="w-3 h-3 text-blue-400 flex-shrink-0 mt-[3px]" />
                <span className={cn(
                  "text-[11px] text-blue-600/80 leading-snug flex-1 min-w-0",
                  !contextExpanded && "line-clamp-1"
                )}>
                  <span className="font-medium text-blue-500 mr-1">{t("review.analysis.contextLabel")}:</span>
                  {additionalRequirements}
                </span>
                {additionalRequirements.length > 60 && (
                  <span className="text-[10px] text-blue-400 flex-shrink-0 group-hover:text-blue-600 transition-colors mt-[2px]">
                    {contextExpanded ? "↑" : "↓"}
                  </span>
                )}
              </button>
            )}

            {/* Cảnh báo tài liệu bị cắt ngắn */}
            {result.truncation_warning && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-700">
                <span className="mt-0.5 shrink-0">⚠️</span>
                <span>{result.truncation_warning}</span>
              </div>
            )}

            {/* Tóm tắt tài liệu */}
            <ResultCard icon={FileText} title={t("review.analysis.sectionDocumentSummary")}>
              <p className="text-[13px] text-foreground/90 leading-relaxed">
                {result.summary || t("review.analysis.noSummary")}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                <Chip>{ext}</Chip>
                {reviewType && (
                  <Chip className="border-violet-200 bg-violet-50 text-violet-600">{reviewType}</Chip>
                )}
                {docDate && <Chip>{docDate}</Chip>}
                <Chip className="border-primary/20 bg-primary/5 text-primary">v{versionNum}</Chip>
              </div>
            </ResultCard>

            {/* Thông tin quan trọng */}
            {result.keyInformation && result.keyInformation.length > 0 && (
              <ResultCard icon={Database} title={t("review.analysis.sectionKeyInformation")}>
                <div className="divide-y divide-border/60 -mx-1 mt-1">
                  {result.keyInformation.map((item, idx) => (
                    <KeyInfoRow key={idx} item={item} />
                  ))}
                </div>
              </ResultCard>
            )}

            {/* Review theo Checklist */}
            {result.checklist.length > 0 && (
              <ResultCard
                icon={ListChecks}
                title={t("review.analysis.sectionChecklist")}
                badge={
                  <div className="flex items-center gap-1">
                    {failCount > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                        {failCount} {t("review.analysis.badgeRisk")}
                      </span>
                    )}
                    {warnCount > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                        {warnCount} {t("review.analysis.badgeWarn")}
                      </span>
                    )}
                    {passCount > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {passCount} {t("review.analysis.badgePass")}
                      </span>
                    )}
                  </div>
                }
              >
                {checklistGrouped && checklistGrouped.length > 0 ? (
                  <div className="space-y-3 mt-1">
                    {checklistGrouped.map((group, gi) => {
                      return (
                        <div key={group.groupLabel}>
                          {gi > 0 && <div className="border-t border-border/50 mb-3" />}
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                            {t(`review.category.${group.groupLabel}` as never, { defaultValue: group.groupLabel })}
                          </p>
                          <ul className="space-y-2">
                            {group.items.map((c) => (
                              <ChecklistItemRow key={c.id} c={c} onAnchorClick={onAnchorClick} />
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <ul className="space-y-2 mt-1">
                    {result.checklist.map((c) => (
                      <ChecklistItemRow key={c.id} c={c} onAnchorClick={onAnchorClick} />
                    ))}
                  </ul>
                )}
              </ResultCard>
            )}

            {/* Kết quả so sánh — identical */}
            {result.comparison?.is_identical && compareMode !== null && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 flex items-center gap-2 text-[13px] font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                {t("review.analysis.identical")}
              </div>
            )}

            {/* Kết quả so sánh — has differences */}
            {result.comparison && !result.comparison.is_identical && compareMode !== null
              && (result.comparison.differences.length > 0 || result.comparison.missingClauses.length > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <GitCompare className="w-4 h-4 text-amber-600" />
                  <h3 className="text-[13px] font-bold text-amber-900 tracking-tight flex-1">
                    {t("review.analysis.sectionCompareResults")}
                  </h3>
                  {compareMode && (
                    <span className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      compareMode === "tracked"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-violet-200 bg-violet-50 text-violet-700"
                    )}>
                      {compareMode === "tracked"
                        ? t("review.analysis.trackedMode", {
                            count: (revisionsDetected?.document ?? 0) + (revisionsDetected?.template ?? 0),
                          })
                        : t("review.analysis.semanticMode")}
                    </span>
                  )}
                </div>

                {compareFileNames && compareFileNames.length > 0 && (
                  <p className="text-[11px] text-amber-700 mb-2">
                    {t("review.analysis.originalFile")}{" "}
                    <span className="font-medium">{compareFileNames.join(", ")}</span>
                  </p>
                )}

                <ul className="space-y-1.5">
                  {result.comparison.differences.map((item, idx) => (
                    <li key={idx} className="flex gap-2 text-[12.5px] text-amber-900 leading-relaxed">
                      <span className="w-4 h-4 rounded-full bg-amber-200 text-amber-800 text-[9px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                        {idx + 1}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                  {result.comparison.missingClauses.length > 0 && (
                    <>
                      <li className="pt-1">
                        <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
                          {t("review.analysis.sectionMissingClauses")}
                        </p>
                      </li>
                      {result.comparison.missingClauses.map((item, idx) => (
                        <li key={`m-${idx}`} className="flex gap-2 text-[12.5px] text-amber-900 leading-relaxed">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </>
                  )}
                  {result.comparison.differences.length === 0 &&
                    result.comparison.missingClauses.length === 0 && (
                    <li className="text-amber-700/60 text-[12.5px] italic px-1">
                      {t("review.analysis.noItems")}
                    </li>
                  )}
                </ul>
                <p className="text-[10.5px] text-amber-600/70 mt-2.5 italic leading-relaxed">
                  {t("review.analysis.compareNote")}
                </p>
              </div>
            )}

            {/* Kết quả tham chiếu */}
            {result.referenceResults && result.referenceResults.length > 0 && refDocFileNames && refDocFileNames.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                <div className="flex items-center gap-2 mb-2.5">
                  <BookOpen className="w-4 h-4 text-blue-600" />
                  <h3 className="text-[13px] font-bold text-blue-900 tracking-tight flex-1">
                    {t("review.analysis.sectionReferenceResults")}
                  </h3>
                </div>
                {refDocFileNames && refDocFileNames.length > 0 && (
                  <p className="text-[11px] text-blue-700 mb-1.5">
                    {t("review.analysis.documentLabel")}{" "}
                    <span className="font-medium">{refDocFileNames.join(", ")}</span>
                  </p>
                )}
                {refNote && (
                  <p className="text-[11px] text-blue-600/80 italic mb-2 px-2 py-1 bg-blue-100/60 rounded border border-blue-200/60">
                    "{refNote}"
                  </p>
                )}
                <div className="space-y-3">
                  {result.referenceResults.map((ref: ReferenceResult, idx: number) => (
                    <div key={idx}>
                      <ul className="space-y-1.5">
                        {ref.findings.map((finding, fi: number) => (
                          <li key={fi} className="flex gap-2 text-[12.5px] text-blue-900 leading-relaxed">
                            <span className="w-4 h-4 rounded-full bg-blue-200 text-blue-800 text-[9px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                              {fi + 1}
                            </span>
                            <span>
                              {typeof finding === "string" ? finding : finding.text}
                              {typeof finding !== "string" && finding.anchorKeyword && (
                                <span className="ml-1.5 text-[10px] text-blue-500 italic">
                                  → "{finding.anchorKeyword}"
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <p className="text-[10.5px] text-blue-600/70 mt-2.5 italic leading-relaxed">
                  {t("review.analysis.referenceNote")}
                </p>
              </div>
            )}

            {/* Phân tích rủi ro */}
            {(result.riskExplanation || (result.riskFactors && result.riskFactors.length > 0) || (result.riskBreakdown && result.riskBreakdown.length > 0)) && (
              <ResultCard icon={AlertCircle} title={t("review.analysis.sectionRiskAnalysis")}>

                {/* Nhận xét tổng quan */}
                {result.riskExplanation && (
                  <p className="text-[12.5px] text-foreground/85 leading-relaxed">
                    {result.riskExplanation}
                  </p>
                )}

                {/* Vấn đề theo danh mục — dạng danh sách, không điểm */}
                {result.riskBreakdown && result.riskBreakdown.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {result.riskBreakdown.map((rb, idx) => (
                      <div key={idx}>
                        {idx > 0 && <div className="border-t border-border/40 pt-2" />}
                        <p className="text-[11.5px] font-semibold text-foreground mb-1">{t(`review.category.${rb.category}` as never, { defaultValue: rb.category })}</p>
                        {rb.issues.length > 0 && (
                          <ul className="space-y-0.5">
                            {rb.issues.map((issue, ii) => (
                              <li key={ii} className="flex items-start gap-1.5 text-[12px] text-foreground/75 leading-snug">
                                <span className="mt-1.5 w-1 h-1 rounded-full bg-muted-foreground/40 flex-shrink-0" />
                                {issue}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Yếu tố rủi ro — tags lấy phần trước dấu –/—/:, dedup */}
                {result.riskFactors && result.riskFactors.length > 0 && (() => {
                  const seen = new Set<string>();
                  const uniqueTags = result.riskFactors.reduce<{ tag: string; full: string }[]>((acc, factor) => {
                    // Bắt tất cả dạng dấu phân cách phổ biến mà LLM có thể trả
                    const tag = factor.split(/\s*[–—\-:]\s*/)[0].trim().slice(0, 50);
                    if (!tag || seen.has(tag.toLowerCase())) return acc;
                    seen.add(tag.toLowerCase());
                    acc.push({ tag, full: factor });
                    return acc;
                  }, []);
                  if (uniqueTags.length === 0) return null;
                  return (
                    <div className="mt-3">
                      <div className="flex flex-wrap gap-1.5">
                        {uniqueTags.map(({ tag, full }) => (
                          <span
                            key={tag}
                            title={full}
                            className="text-[11px] uppercase px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-medium cursor-default"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </ResultCard>
            )}

            {/* Đề xuất chỉnh sửa — merged: gợi ý cụ thể AI + suggestion tabs */}
            <div data-section="suggest-edits">
            <ResultCard
              icon={Sparkles}
              title={t("review.analysis.sectionSuggestEdits")}
            >
              {/* 3 Tab buttons */}
              <div className="grid grid-cols-3 gap-1.5">
                {SUGGEST_MODES.map(({ key, label }) => {
                  const active = suggestMode === key;
                  const count = editsByMode[key].length;
                  return (
                    <button
                      key={key}
                      onClick={() => setSuggestMode(active ? null : key)}
                      className={cn(
                        "h-8 rounded-md text-[11px] font-medium px-2 border transition-colors relative",
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-foreground border-border hover:bg-muted"
                      )}
                    >
                      {label}
                      {count > 0 && (
                        <span className={cn(
                          "absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center",
                          active ? "bg-white text-primary" : "bg-primary text-primary-foreground"
                        )}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Tab content: EditEvaluation cards hoặc text fallback */}
              {suggestMode && (
                <div className="mt-2.5 space-y-2">
                  {editsByMode[suggestMode].length > 0 ? (
                    <>
                      {/* Apply tất cả / Bỏ áp dụng controls */}
                      {(() => {
                        const pendingCount = editsByMode[suggestMode].filter(
                          (e: EditEvaluation) => !pendingEdits?.[e.modified_text] && !committedEdits?.[e.modified_text]
                        ).length;
                        const appliedCount = editsByMode[suggestMode].filter(
                          (e: EditEvaluation) => !!pendingEdits?.[e.modified_text]
                        ).length;
                        const committedCount = editsByMode[suggestMode].filter(
                          (e: EditEvaluation) => !!committedEdits?.[e.modified_text]
                        ).length;
                        if (editsByMode[suggestMode].length === 0) return null;
                        return (
                          <div className="flex items-center justify-between px-0.5 mb-1">
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1 flex-wrap">
                              {committedCount > 0 && (
                                <span className="text-emerald-700 font-medium bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                  ✓ {t("review.analysis.appliedCount", { count: committedCount })}
                                </span>
                              )}
                              {appliedCount > 0 && (
                                <span className="text-primary font-medium">{appliedCount}{t("review.analysis.pendingApply")}</span>
                              )}
                            </span>
                            <div className="flex gap-2">
                              {pendingCount > 0 && (
                                <button className="text-[11px] text-primary hover:underline font-medium" onClick={handleApplyAllInTab}>
                                  {t("review.analysis.selectAll")}
                                </button>
                              )}
                              {appliedCount > 0 && (
                                <button className="text-[11px] text-muted-foreground hover:underline" onClick={handleUndoAllInTab}>
                                  {t("review.analysis.unselectAll")}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                    {editsByMode[suggestMode].map((edit: EditEvaluation) => {
                      const isCommitted = !!(committedEdits?.[edit.modified_text]);
                      const isPending = !isCommitted && !!(pendingEdits?.[edit.modified_text]);
                      const isApplied = isCommitted || isPending;
                      const riskBadgeClass =
                        edit.risk_level === "high" ? "bg-red-50 text-red-700 border-red-200"
                        : edit.risk_level === "medium" ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200";
                      const riskLabelText =
                        edit.risk_level === "high" ? t("review.analysis.riskHigh")
                        : edit.risk_level === "medium" ? t("review.analysis.riskMedium") : t("review.analysis.riskLow");
                      return (
                        <div
                          key={edit.id}
                          ref={(el) => { editCardRefs.current[edit.id] = el; }}
                          className={cn(
                            "rounded-xl border overflow-hidden transition-colors cursor-pointer",
                            isCommitted
                              ? "border-emerald-300 bg-emerald-50/80"
                              : isPending
                                ? "border-emerald-200 bg-emerald-50/40"
                                : "border-border bg-card hover:border-border/80"
                          )}
                          onClick={() => onAnchorClick(edit.modified_text || edit.anchor_text || "")}
                          title={t("review.analysis.goToPosition")}
                        >
                          {/* Header: checkbox + clause name + badges */}
                          <div
                            className="flex items-center gap-1.5 px-3 py-2 bg-muted/40 border-b border-border"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* Committed: locked checkbox; Pending: can untick; Unchecked: can tick */}
                            <button
                              disabled={isCommitted}
                              className={cn(
                                "w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors",
                                isCommitted
                                  ? "bg-emerald-600 border-emerald-600 text-white cursor-not-allowed"
                                  : isPending
                                    ? "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600"
                                    : "border-border hover:border-primary bg-card"
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isCommitted) return;
                                if (isPending) {
                                  onUndoEdit?.(edit.modified_text, edit.bilingual_modified_text);
                                } else {
                                  onApplyEdit?.(edit.id, edit.modified_text, edit.suggested_text, edit.risk_level, edit.clause_name, edit.bilingual_modified_text, edit.bilingual_suggested_text);
                                }
                                onAnchorClick(edit.modified_text || edit.anchor_text || "");
                              }}
                              title={isCommitted ? t("review.analysis.committedTooltip", { defaultValue: "Đã áp dụng vào version" }) : isPending ? t("review.analysis.unapplyTooltip") : t("review.analysis.applyToDoc")}
                            >
                              {isApplied && <Check className="w-2.5 h-2.5" />}
                            </button>
                            <p className="text-[11.5px] font-semibold text-foreground flex-1 min-w-0 truncate">
                              {edit.clause_name}
                            </p>
                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-semibold flex-shrink-0", riskBadgeClass)}>
                              {riskLabelText}
                            </span>
                            {isCommitted ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-100 text-emerald-700 font-semibold flex-shrink-0">
                                {t("review.analysis.committedBadge", { defaultValue: "Đã lưu" })}
                              </span>
                            ) : isPending ? (
                              <span className="text-[10px] font-semibold text-emerald-600 flex-shrink-0">
                                {t("review.analysis.appliedBadge")}
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 font-medium flex-shrink-0">
                                {t("review.analysis.needsFixBadge")}
                              </span>
                            )}
                            {newEditIds?.has(edit.id) ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-violet-300 bg-violet-50 text-violet-700 font-semibold flex-shrink-0">
                                {t("review.analysis.newBadge")}
                              </span>
                            ) : edit.id.startsWith("qa-") && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-violet-200 bg-violet-50/60 text-violet-500 font-medium flex-shrink-0">
                                {t("review.analysis.aiSuggestedBadge")}
                              </span>
                            )}
                            {edit.verbatim_match === false && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-500 font-medium flex-shrink-0"
                                title="AI không sao chép nguyên văn đoạn này từ tài liệu — vị trí hiển thị có thể không chính xác"
                              >
                                {t("review.analysis.estimatedPosition")}
                              </span>
                            )}
                          </div>

                          {/* Body */}
                          <div className="px-3 py-2.5 space-y-2">
                            {/* Vietnamese original text */}
                            <p className="text-[11.5px] text-foreground/75 leading-relaxed italic line-clamp-3">
                              "{edit.modified_text}"
                            </p>
                            {/* English parallel text (bilingual) */}
                            {edit.bilingual_modified_text && (
                              <p className="text-[11px] text-foreground/55 leading-relaxed italic line-clamp-2 flex gap-1 items-start">
                                <span className="text-[9px] font-semibold text-blue-500 bg-blue-50 border border-blue-200 rounded px-1 py-0.5 flex-shrink-0 not-italic mt-0.5">EN</span>
                                <span>"{edit.bilingual_modified_text}"</span>
                              </p>
                            )}

                            {edit.reason && (
                              <p className="text-[11px] text-muted-foreground leading-snug">
                                {edit.reason}
                              </p>
                            )}

                            {edit.suggested_text && (
                              <div className="pt-1.5 border-t border-border/50 space-y-1.5">
                                <p className={`text-[10px] font-bold uppercase tracking-wide mb-0.5 ${isApplied ? "text-emerald-600" : "text-emerald-700"}`}>
                                  {isApplied ? t("review.analysis.appliedLabel") : t("review.analysis.suggestedLabel")}
                                </p>
                                {/* Vietnamese suggestion */}
                                <div className="flex gap-1.5 items-start">
                                  {edit.bilingual_suggested_text && (
                                    <span className="text-[9px] font-semibold text-orange-500 bg-orange-50 border border-orange-200 rounded px-1 py-0.5 flex-shrink-0 mt-0.5">VI</span>
                                  )}
                                  <p className={`text-[11.5px] leading-relaxed whitespace-pre-wrap ${isApplied ? "text-emerald-700/80" : "text-emerald-800"}`}>
                                    {edit.suggested_text}
                                  </p>
                                </div>
                                {/* English parallel suggestion (bilingual) */}
                                {edit.bilingual_suggested_text && (
                                  <div className="flex gap-1.5 items-start pt-1 border-t border-emerald-100">
                                    <span className="text-[9px] font-semibold text-blue-500 bg-blue-50 border border-blue-200 rounded px-1 py-0.5 flex-shrink-0 mt-0.5">EN</span>
                                    <p className={`text-[11.5px] leading-relaxed whitespace-pre-wrap ${isApplied ? "text-emerald-600/70" : "text-emerald-700/90"}`}>
                                      {edit.bilingual_suggested_text}
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    </>
                  ) : (
                    /* Fallback text khi không có edits */
                    suggestContent[suggestMode].map((s, i) => {
                      if (dismissedSugg[suggestMode].has(i)) return null;
                      return (
                        <div key={i} className="p-2.5 rounded-lg border border-border bg-card">
                          <div className="flex gap-2 items-start">
                            <Sparkles className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                            <p className="text-[12px] text-foreground/85 leading-relaxed flex-1">{s}</p>
                            <button
                              onClick={() => handleDismissSugg(suggestMode, i)}
                              className="text-muted-foreground/60 hover:text-foreground flex-shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Nút lưu phiên bản — chỉ lưu edits mới của tab đang active (chưa save) */}
              {suggestMode && (() => {
                if (editsByMode[suggestMode].length === 0) return null;
                // Pending edits trong tab này — chưa commit, sẽ được Apply
                const tabPendingEdits = editsByMode[suggestMode].filter(
                  (e: EditEvaluation) => !!pendingEdits?.[e.modified_text]
                );
                const canSave = tabPendingEdits.length > 0 && !!onSaveVersion;
                const tabEditsToSave = tabPendingEdits.reduce(
                  (acc, e) => {
                    const entry = pendingEdits?.[e.modified_text];
                    if (entry) acc[e.modified_text] = entry;
                    if (e.bilingual_modified_text) {
                      const bilEntry = pendingEdits?.[e.bilingual_modified_text];
                      if (bilEntry) acc[e.bilingual_modified_text] = bilEntry;
                    }
                    return acc;
                  },
                  {} as Record<string, { suggested: string; riskLevel: RiskLevelEdit | string; clauseName?: string }>
                );
                const committedInTab = editsByMode[suggestMode].filter(
                  (e: EditEvaluation) => !!committedEdits?.[e.modified_text]
                ).length;
                return (
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs gap-1.5 mt-2.5"
                    disabled={!canSave || isRecalculating}
                    onClick={() => {
                      if (!suggestMode) return;
                      const hasQAEdits = tabPendingEdits.some((e: EditEvaluation) => e.id.startsWith("qa-"));
                      const label = hasQAEdits
                        ? t("review.analysis.applyVersionLabelQA", { mode: SUGGEST_MODE_LABELS[suggestMode] })
                        : t("review.analysis.applyVersionLabel", { mode: SUGGEST_MODE_LABELS[suggestMode] });
                      onSaveVersion?.(label, tabEditsToSave);
                    }}
                  >
                    {canSave ? (
                      <><Save className="w-3.5 h-3.5" /> {t("review.analysis.saveVersionApply", { count: tabPendingEdits.length })}</>
                    ) : committedInTab > 0 ? (
                      <><Check className="w-3.5 h-3.5" /> {t("review.analysis.saveVersionApplied", { count: committedInTab })}</>
                    ) : (
                      <><Check className="w-3.5 h-3.5" /> {t("review.analysis.saveVersionPrompt")}</>
                    )}
                  </Button>
                );
              })()}
            </ResultCard>
            </div>

            {/* Danh sách edits đã bỏ qua — collapsible */}
            {ignoredEditIds && ignoredEditIds.size > 0 && (() => {
              const ignoredEdits = allEdits.filter((e: EditEvaluation) => ignoredEditIds.has(e.id));
              if (ignoredEdits.length === 0) return null;
              return (
                <details className="rounded-lg border border-border/60 bg-muted/30 overflow-hidden">
                  <summary className="flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-muted-foreground cursor-pointer select-none hover:bg-muted/50 transition-colors list-none">
                    <X className="w-3 h-3" />
                    {t("review.analysis.ignoredSection", { count: ignoredEdits.length })}
                    <span className="ml-auto text-[10px] font-normal opacity-60">{t("review.analysis.clickToExpand")}</span>
                  </summary>
                  <div className="px-3 pb-3 pt-1 space-y-1.5">
                    {ignoredEdits.map((edit: EditEvaluation) => (
                      <div key={edit.id} className="flex items-center gap-2 text-[12px] text-muted-foreground">
                        <span className="flex-1 truncate">{edit.clause_name || edit.modified_text.slice(0, 40)}</span>
                        <button
                          className="text-[10px] text-primary hover:underline flex-shrink-0"
                          onClick={() => onIgnoreEdit?.(edit.id)}
                          title={t("review.analysis.restoreItem")}
                        >
                          {t("review.analysis.restore")}
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })()}

            {/* Điểm rủi ro */}
            <ResultCard icon={CircleDot} title={t("review.analysis.sectionRiskScore")}>
              <div className={`p-3 rounded-lg border ${riskTone} relative`}>
                {isRecalculating && (
                  <div className="absolute inset-0 rounded-lg bg-white/60 flex items-center justify-center gap-2 z-10">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-xs font-medium text-primary">{t("review.analysis.recalculating")}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-4xl font-bold leading-none">
                    {currentScore}
                    <span className="text-sm font-normal opacity-70">/100</span>
                  </p>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/60 border border-current/20">
                      {riskLabel}
                    </span>
                    {/* {scoreImprovement && scoreImprovement.delta > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                        ↓ {scoreImprovement.delta} điểm cải thiện
                      </span>
                    )} */}
                  </div>
                </div>
                <div className="mt-3 h-1.5 rounded-full bg-white/50 overflow-hidden">
                  <div
                    className="h-full bg-current opacity-70 transition-all duration-700"
                    style={{ width: `${currentScore}%` }}
                  />
                </div>
                {/* {scoreImprovement?.summary && (
                  <p className="text-[11.5px] mt-2 opacity-80 leading-relaxed">
                    {scoreImprovement.summary}
                  </p>
                )}
                {!scoreImprovement && appliedEditsCount > 0 && !isRecalculating && (
                  <p className="text-[11px] mt-2 opacity-60">
                    {appliedEditsCount} đề xuất đã áp dụng — đang chờ đánh giá lại...
                  </p>
                )} */}
              </div>
            </ResultCard>

            {/* Hỏi AI thêm — panel hợp nhất: result + input cùng container */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 overflow-hidden">

              {/* Header */}
              <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                <RefreshCw className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <p className="text-sm font-semibold text-foreground flex-1">{t("review.analysis.aiRequestTitle")}</p>
                {!isViewingHistory && (
                  <p className="text-[10.5px] text-muted-foreground">{t("review.analysis.aiRequestSubtitle")}</p>
                )}
              </div>

              {/* ── Vùng phản hồi — loading hoặc kết quả ── */}
              {(quickActionLoading || quickActionResult?.summary) && (
                <div className="mx-3 mt-2 rounded-md border border-violet-200 bg-violet-50/80 overflow-hidden">

                  {/* Bubble câu hỏi của user — dùng persisted instruction khi xem history */}
                  {(isViewingHistory ? quickActionResult?.userInstruction : lastInstruction) && (
                    <div className="flex justify-end px-2.5 pt-2.5 pb-1">
                      <span className="text-[11px] bg-white/80 border border-violet-100 text-foreground/70 rounded-lg rounded-tr-sm px-2.5 py-1.5 max-w-[90%] leading-snug">
                        {isViewingHistory ? quickActionResult?.userInstruction : lastInstruction}
                      </span>
                    </div>
                  )}

                  {quickActionLoading ? (
                    /* Loading skeleton */
                    <div className="flex items-center gap-2.5 px-3 py-2.5">
                      <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin flex-shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-2 rounded bg-violet-200/70 animate-pulse w-3/4" />
                        <div className="h-2 rounded bg-violet-200/70 animate-pulse w-1/2" />
                      </div>
                    </div>
                  ) : quickActionResult?.summary ? (
                    /* Kết quả */
                    <div className="px-3 pb-2.5 pt-1.5">
                      <div className="flex items-start gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-violet-500 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className={cn("text-[12px] text-violet-900 leading-relaxed",
                            !resultExpanded && "line-clamp-4")}>
                            {quickActionResult.summary}
                          </p>
                          {(quickActionResult.summary.length > 120 || quickActionResult.summary.includes("\n")) && (
                            <button
                              className="border-0 bg-transparent p-0 text-[11px] text-violet-500 hover:text-violet-700 mt-0.5 transition-colors cursor-pointer"
                              onClick={() => setResultExpanded(v => !v)}
                            >
                              {resultExpanded ? t("review.analysis.aiResultCollapse") : t("review.analysis.aiResultViewMore")}
                            </button>
                          )}
                        </div>
                        {/* Chỉ cho dismiss khi xem latest — dismiss khi xem history sẽ xoá nhầm latest result */}
                        {!isViewingHistory && (
                          <button
                            className="flex-shrink-0 text-violet-300 hover:text-violet-500 transition-colors -mt-0.5"
                            onClick={() => {
                              setLastInstruction("");
                              setResultExpanded(false);
                              dismissQuickAction();
                            }}
                            title={t("common.close")}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-violet-200/60">
                        {isViewingHistory ? (
                          /* Xem history: dùng số edits đã lưu trong version */
                          (quickActionResult.suggested_edits?.length ?? 0) > 0 ? (
                            <span className="text-[11px] text-violet-600 flex items-center gap-1">
                              <Check className="w-3 h-3 flex-shrink-0" />
                              {t("review.analysis.suggestedEditsAdded", { count: quickActionResult.suggested_edits!.length })}
                            </span>
                          ) : (
                            <span className="text-[11px] text-violet-500 italic">
                              {t("review.analysis.aiResultNoNewEdits")}
                            </span>
                          )
                        ) : (
                          /* Xem latest: dùng newEditIds (chỉ hiện trong 5 phút sau khi thêm) */
                          (newEditIds && newEditIds.size > 0) ? (
                            <span className="text-[11px] text-violet-600 flex items-center gap-1">
                              <Check className="w-3 h-3 flex-shrink-0" />
                              {t("review.analysis.suggestedEditsAdded", { count: newEditIds.size })}
                            </span>
                          ) : quickActionResult.suggested_edits !== undefined && (
                            <span className="text-[11px] text-violet-500 italic">
                              {t("review.analysis.aiResultNoNewEdits")}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* ── Input area: ẩn khi xem version cũ, thay bằng note ── */}
              {isViewingHistory ? (
                <div className="px-3 pb-3 pt-2 flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                  <p className="text-[11px] text-muted-foreground/70 leading-snug">
                    {t("review.analysis.aiRequestDisabledInHistory")}
                  </p>
                </div>
              ) : (
                <div className="px-3 pb-3 pt-2">
                  <Textarea
                    value={loopInput}
                    onChange={(e) => setLoopInput(e.target.value)}
                    disabled={quickActionLoading}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !quickActionLoading && loopInput.trim()) {
                        e.preventDefault();
                        handleLoopSubmit();
                      }
                    }}
                    className="min-h-[64px] text-xs resize-none bg-card disabled:opacity-50"
                    placeholder={t("review.analysis.aiRequestPlaceholder")}
                  />
                  <div className="flex items-center justify-between mt-1.5 gap-2">
                    <span className="text-[10px] text-muted-foreground/50 select-none">Ctrl+Enter</span>
                    <Button
                      className="gap-1.5 h-7 text-xs px-3"
                      size="sm"
                      disabled={quickActionLoading || !loopInput.trim()}
                      onClick={handleLoopSubmit}
                    >
                      <Send className="w-3 h-3" />
                      {t("review.analysis.aiRequestSend")}
                    </Button>
                  </div>
                </div>
              )}
            </div>


            {/* Lưu tiến trình */}
            {onMarkCompleted && (
              <Button
                className={cn(
                  "w-full gap-2 transition-all duration-300",
                  markingCompleted
                    ? "bg-primary/70 text-primary-foreground cursor-wait"
                    : progressSaved
                      ? "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 cursor-default"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
                size="default"
                disabled={markingCompleted || progressSaved || isRecalculating}
                onClick={onMarkCompleted}
              >
                {markingCompleted ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : progressSaved ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {markingCompleted
                  ? t("review.analysis.savingProgress")
                  : progressSaved
                    ? t("review.analysis.progressSaved")
                    : t("review.analysis.saveProgress")}
              </Button>
            )}

          </div>
        )}

        {/* ── Version tab ───────────────────────────────────────────────────── */}
        {tab === "version" && (
          <div className="px-4 py-3 space-y-2">
            {(versionHistory && versionHistory.length > 0 ? [...versionHistory].reverse() : []).map((v, idx) => {
              const isLatest = idx === 0;
              const isViewing = activeVersionNum === v.num
                || (activeVersionNum === null && isLatest);
              const isExpanded = expandedVersions.has(v.num);
              const scoreColor =
                v.score >= 61 ? "bg-red-50 text-red-700 border-red-200"
                  : v.score >= 41 ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200";
              const typeColor: Record<VersionEntry["type"], string> = {
                ai_review: "bg-blue-50 text-blue-700 border-blue-200",
                apply_suggestion: "bg-emerald-50 text-emerald-700 border-emerald-200",
                ai_request: "bg-violet-50 text-violet-700 border-violet-200",
                user_edit: "bg-orange-50 text-orange-700 border-orange-200",
                ai_generated_clause: "bg-teal-50 text-teal-700 border-teal-200",
                restore: "bg-amber-50 text-amber-700 border-amber-200",
              };
              const timeStr = v.timestamp.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
              const editEntries = v.type === "apply_suggestion" && v.appliedEdits
                ? Object.entries(v.appliedEdits)
                : [];
              return (
                <div key={v.num} className="space-y-0">
                  <div
                    className={cn(
                      "w-full rounded-lg border p-2.5 transition-colors",
                      isExpanded ? "rounded-b-none border-b-0" : "",
                      isViewing
                        ? "border-primary/30 bg-primary/5 ring-1 ring-primary/20"
                        : "border-border bg-card hover:bg-muted/40 cursor-pointer"
                    )}
                    onClick={() => {
                      if (!isViewing) {
                        onSwitchVersion?.(v.num);
                        setTab("review");
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn(
                          "w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold flex-shrink-0",
                          isViewing ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                        )}>
                          v{v.num}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-semibold text-foreground truncate">
                            {docName ?? t("review.analysis.docFallback")}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{timeStr}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {isLatest && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground">
                            {t("review.analysis.versionLatest")}
                          </span>
                        )}
                        {isViewing ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                            {t("review.analysis.versionViewing")}
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-primary/30 text-primary hover:bg-primary/5">
                            {t("review.analysis.versionView")}
                          </span>
                        )}
                        {!isLatest && onRestoreVersion && (
                          <button
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors flex items-center gap-0.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRestoreVersion(v.num);
                            }}
                            title={t("review.analysis.restoreVersionTooltip")}
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                            {t("review.analysis.restoreVersionBtn")}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", typeColor[v.type])}>
                        {v.label}
                      </span>
                      {v.reviewType && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-violet-50 text-violet-700 border-violet-200">
                          {v.reviewType}
                        </span>
                      )}
                      {editEntries.length > 0 && (
                        <button
                          className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 font-medium hover:bg-emerald-100 transition-colors flex items-center gap-0.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedVersions((prev) => {
                              const next = new Set(prev);
                              if (next.has(v.num)) next.delete(v.num);
                              else next.add(v.num);
                              return next;
                            });
                          }}
                          title={t("review.analysis.viewEditDetails")}
                        >
                          {t("review.analysis.versionEditsCount", { count: editEntries.length })} {isExpanded ? "▲" : "▼"}
                        </button>
                      )}
                      <span className={cn("ml-auto text-[10px] px-1.5 py-0.5 rounded border font-semibold", scoreColor)}>
                        Score: {v.score}
                      </span>
                    </div>
                  </div>

                  {/* Sub-items: danh sách edits với click-to-navigate */}
                  {isExpanded && editEntries.length > 0 && (
                    <div className="rounded-b-lg border border-t-0 border-border bg-muted/30 divide-y divide-border/50">
                      {editEntries.map(([modifiedText, { clauseName, riskLevel }]) => (
                        <button
                          key={modifiedText}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/60 transition-colors group"
                          onClick={() => {
                            onAnchorClick(modifiedText);
                            setTab("review");
                          }}
                          title="Nhấn để xem vị trí trong tài liệu"
                        >
                          <Check className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                          <span className="text-[11px] text-foreground/80 flex-1 min-w-0 truncate group-hover:text-foreground">
                            {clauseName ?? modifiedText.slice(0, 50)}
                          </span>
                          <span className={cn(
                            "text-[9px] px-1 py-0.5 rounded border flex-shrink-0",
                            riskLevel === "high" ? "bg-red-50 text-red-600 border-red-200"
                              : riskLevel === "medium" ? "bg-amber-50 text-amber-600 border-amber-200"
                              : "bg-emerald-50 text-emerald-600 border-emerald-200"
                          )}>
                            {riskLevel === "high" ? t("review.analysis.riskHigh") : riskLevel === "medium" ? t("review.analysis.riskMediumAbbr") : t("review.analysis.riskLow")}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {(!versionHistory || versionHistory.length === 0) && (
              <div className="rounded-lg border border-border bg-card p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                      v{versionNum}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-foreground truncate">{docName ?? t("review.analysis.docFallback")}</p>
                      <p className="text-[11px] text-muted-foreground">{docDate ?? "—"}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary text-primary-foreground flex-shrink-0">
                    {t("review.analysis.currentVersion")}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">
                    {t("review.analysis.versionAiReview")}
                  </span>
                  {reviewType && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-violet-50 text-violet-700 border-violet-200">
                      {reviewType}
                    </span>
                  )}
                  <span className={cn(
                    "ml-auto text-[10px] px-1.5 py-0.5 rounded border font-semibold",
                    currentScore >= 61 ? "bg-red-50 text-red-700 border-red-200"
                      : currentScore >= 41 ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200"
                  )}>
                    Score: {currentScore}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

      </ScrollArea>

      {/* Footer cố định — nút tải xuống luôn hiển thị dưới cùng, tách nền khỏi theme trắng */}
      {tab === "review" && (onDownloadPdf || onDownloadDocx) && (
        <div className="flex gap-2 border-t border-border bg-muted/40 px-4 py-2.5">
          {onDownloadPdf && (
            <Button
              size="sm" variant="outline"
              className="flex-1 h-9 gap-1.5 text-xs bg-card shadow-sm border-border hover:bg-accent"
              disabled={downloadingPdf}
              onClick={onDownloadPdf}
            >
              {downloadingPdf
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <FileDown className="w-3.5 h-3.5" />}
              {t("review.analysis.downloadPdf")}
            </Button>
          )}
          {onDownloadDocx && (
            <Button
              size="sm" variant="outline"
              className="flex-1 h-9 gap-1.5 text-xs bg-card shadow-sm border-border hover:bg-accent"
              disabled={downloadingDocx}
              title={
                hasComparisonEdits
                  ? t("review.analysis.downloadDocxTooltip")
                  : t("review.analysis.downloadDocxNoCompareTooltip")
              }
              onClick={onDownloadDocx}
            >
              {downloadingDocx
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <ScrollText className="w-3.5 h-3.5" />}
              {hasComparisonEdits
                ? t("review.analysis.downloadDocx")
                : t("review.analysis.downloadDocxBtn")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
