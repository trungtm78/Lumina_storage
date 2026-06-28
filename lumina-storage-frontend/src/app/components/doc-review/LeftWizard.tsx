import { useRef, useState, useEffect, type Dispatch, type SetStateAction, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  Upload,
  Link as LinkIcon,
  ToggleLeft,
  ToggleRight,
  ArrowRight,
  GitCompare,
  Play,
  Loader2,
  FileSearch,
  History,
  FileText,
  Check,
  X,
  Plus,
  Minus,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Sparkles,
  BookOpen,
} from "lucide-react";
import { documentsApi } from "@/app/api/endpoints/documents";
import {
  REVIEW_CHECKLISTS,
  REVIEW_TYPE_META,
  type ChecklistCategory,
  type DocSource,
  type ReviewChecklistItem,
  type ReviewType,
  type TemplateSource,
} from "@/app/api/endpoints/review";
import { cn } from "@/app/components/ui/utils";
import { Button } from "@/app/components/ui/button";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { StepLabel } from "./StepLabel";

export interface ReviewDocItem {
  id: string;
  name: string;
  date?: string;
  reviewed?: boolean;
}

export interface LeftWizardProps {
  documents: ReviewDocItem[];
  selectedDoc: ReviewDocItem | null;
  setSelectedDoc: (doc: ReviewDocItem | null) => void;
  docSource: DocSource;
  setDocSource: Dispatch<SetStateAction<DocSource>>;
  sourceUrl: string;
  setSourceUrl: Dispatch<SetStateAction<string>>;

  compareEnabled: boolean;
  setCompareEnabled: Dispatch<SetStateAction<boolean>>;
  templateSource: TemplateSource;
  setTemplateSource: Dispatch<SetStateAction<TemplateSource>>;
  compareDocIds: string[];
  setCompareDocIds: Dispatch<SetStateAction<string[]>>;

  additionalRequirements: string;
  setAdditionalRequirements: Dispatch<SetStateAction<string>>;

  referenceEnabled: boolean;
  setReferenceEnabled: Dispatch<SetStateAction<boolean>>;
  referenceDocIds: string[];
  setReferenceDocIds: Dispatch<SetStateAction<string[]>>;
  referenceContent: string;
  setReferenceContent: Dispatch<SetStateAction<string>>;

  reviewType: ReviewType;
  onReviewTypeChange: (type: ReviewType) => void;

  checklist: ReviewChecklistItem[];
  toggleChecklistItem: (id: string) => void;
  toggleCategoryItems?: (category: string, checked: boolean) => void;
  addChecklistItem?: (label: string) => void;
  removeChecklistItem?: (id: string) => void;
  resetChecklistToAi?: () => void;
  hasAiSuggestion?: boolean;
  selectAllChecklist?: () => void;
  clearAllChecklist?: () => void;

  isReviewing: boolean;
  onRunReview: () => void;

  /** true khi doc text đã được tải xong — trigger auto-scroll sang step 2 */
  docReady?: boolean;

  /** true khi AI đang gợi ý checklist */
  suggestingChecklist?: boolean;

  /** Mở drawer "Tài liệu của tôi" (khi chưa chọn file) */
  onOpenMyDocs?: () => void;
  /** Mở drawer "Lịch sử tiến trình" (khi đã chọn file) */
  onOpenProgressHistory?: () => void;

  className?: string;
}

// ─── ChecklistGrouped ─────────────────────────────────────────────────────────
// Renders checklist items grouped by category với collapsible sections + tooltips.

interface ChecklistGroupedProps {
  items: ReviewChecklistItem[];
  collapsedCategories: Set<string>;
  toggleCategory: (cat: string) => void;
  toggleChecklistItem: (id: string) => void;
  toggleCategoryItems?: (category: string, checked: boolean) => void;
  removeChecklistItem?: (id: string) => void;
}

function ChecklistGrouped({
  items,
  collapsedCategories,
  toggleCategory,
  toggleChecklistItem,
  toggleCategoryItems,
  removeChecklistItem,
}: ChecklistGroupedProps) {
  const { t } = useTranslation();
  // Nhóm items theo category; uncategorized vào nhóm t("review.wizard.uncategorized")
  const uncategorizedLabel = t("review.wizard.uncategorized");
  const groups = items.reduce<Record<string, ReviewChecklistItem[]>>((acc, item) => {
    const cat = item.category ?? uncategorizedLabel;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const categoryOrder: ChecklistCategory[] = [
    "Format", "Thông tin", "Pháp lý", "Nghĩa vụ", "Quyền lợi",
    "Thanh toán", "Phạt vi phạm", "Thời hạn", "Rủi ro", "Tóm tắt", "So sánh",
  ];

  // Sắp xếp categories theo thứ tự spec, uncategorized xuống cuối
  const sortedCats = [
    ...categoryOrder.filter((c) => groups[c]),
    ...Object.keys(groups).filter((c) => !categoryOrder.includes(c as ChecklistCategory)),
  ];

  if (sortedCats.length === 0) return null;

  // Nếu tất cả items không có category → render flat list (backward compat)
  const hasCats = items.some((i) => i.category);
  if (!hasCats) {
    return (
      <div className="space-y-1 overflow-x-hidden">
        {items.map((item) => (
          <ChecklistRow
            key={item.id}
            item={item}
            toggleChecklistItem={toggleChecklistItem}
            removeChecklistItem={removeChecklistItem}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1 overflow-x-hidden">
      {sortedCats.map((cat) => {
        const catItems = groups[cat];
        const checkedCount = catItems.filter((i) => i.checked).length;
        const collapsed = collapsedCategories.has(cat);
        return (
          <div key={cat} className="border-border/60 overflow-hidden rounded-md border">
            {/* Category header */}
            <div className="bg-muted/30 hover:bg-muted/60 flex w-full items-center justify-between px-3 py-2 transition-colors">
              {toggleCategoryItems && (
                <div
                  role="checkbox"
                  aria-checked={checkedCount === catItems.length ? true : checkedCount > 0 ? "mixed" : false}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCategoryItems(cat, checkedCount < catItems.length);
                  }}
                  className={cn(
                    "mr-2 flex h-4 w-4 flex-shrink-0 cursor-pointer items-center justify-center rounded border-2 transition-all",
                    checkedCount === catItems.length
                      ? "border-brand-500 bg-brand-500"
                      : checkedCount > 0
                        ? "border-brand-500 bg-transparent"
                        : "border-border bg-transparent",
                  )}
                >
                  {checkedCount === catItems.length && <Check className="h-2.5 w-2.5 text-white" />}
                  {checkedCount > 0 && checkedCount < catItems.length && <Minus className="text-brand-500 h-2.5 w-2.5" />}
                </div>
              )}
              <button
                onClick={() => toggleCategory(cat)}
                className="flex min-w-0 flex-1 items-center gap-1.5"
              >
                {collapsed ? (
                  <ChevronRight className="text-muted-foreground/70 h-3 w-3 flex-shrink-0" />
                ) : (
                  <ChevronDown className="text-muted-foreground/70 h-3 w-3 flex-shrink-0" />
                )}
                <span className="text-foreground/80 truncate text-xs font-bold tracking-wide">
                  {t(`review.category.${cat}` as never, { defaultValue: cat })}
                </span>
              </button>
              <span className={cn(
                "ml-1 flex-shrink-0 text-[11px] font-semibold tabular-nums",
                checkedCount > 0 ? "text-brand-600" : "text-muted-foreground",
              )}>
                {checkedCount}/{catItems.length}
              </span>
            </div>
            {/* Items */}
            {!collapsed && (
              <div className="bg-background/80 space-y-0.5 px-1 py-1">
                {catItems.map((item) => (
                  <ChecklistRow
                    key={item.id}
                    item={item}
                    toggleChecklistItem={toggleChecklistItem}
                    removeChecklistItem={removeChecklistItem}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface ChecklistRowProps {
  item: ReviewChecklistItem;
  toggleChecklistItem: (id: string) => void;
  removeChecklistItem?: (id: string) => void;
}

function ChecklistRow({ item, toggleChecklistItem, removeChecklistItem }: ChecklistRowProps) {
  const { t } = useTranslation();
  const label = t(`review.checklist.${item.id}.label` as never, { defaultValue: item.label });
  const description = item.description
    ? t(`review.checklist.${item.id}.description` as never, { defaultValue: item.description })
    : undefined;
  return (
    <div className="hover:bg-muted/50 group flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-1.5">
      <div
        className="mt-0.5 flex-shrink-0"
        onClick={() => toggleChecklistItem(item.id)}
      >
        <div
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded border-2 transition-all",
            item.checked
              ? "border-brand-500 bg-brand-500"
              : "border-border group-hover:border-brand-400",
          )}
        >
          {item.checked && <Check className="h-2.5 w-2.5 text-white" />}
        </div>
      </div>
      <span
        className={cn(
          "min-w-0 flex-1 text-[13px] leading-snug",
          item.checked ? "text-foreground font-semibold" : "text-muted-foreground font-medium",
        )}
        onClick={() => toggleChecklistItem(item.id)}
      >
        {label}
      </span>
      {description && (
        <span title={description} className="text-muted-foreground/40 hover:text-muted-foreground mt-0.5 flex-shrink-0 cursor-help">
          <HelpCircle className="h-3 w-3" />
        </span>
      )}
      {removeChecklistItem && (
        <button
          onClick={(e) => { e.stopPropagation(); removeChecklistItem(item.id); }}
          className="text-muted-foreground hover:text-red-500 mt-0.5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ─── LeftWizard ───────────────────────────────────────────────────────────────

export function LeftWizard(props: LeftWizardProps) {
  const {
    documents,
    selectedDoc,
    setSelectedDoc,
    docSource,
    setDocSource,
    sourceUrl,
    setSourceUrl,
    compareEnabled,
    setCompareEnabled,
    templateSource,
    setTemplateSource,
    compareDocIds,
    setCompareDocIds,
    additionalRequirements,
    setAdditionalRequirements,
    referenceEnabled,
    setReferenceEnabled,
    referenceDocIds,
    setReferenceDocIds,
    referenceContent,
    setReferenceContent,
    reviewType,
    onReviewTypeChange,
    checklist,
    toggleChecklistItem,
    toggleCategoryItems,
    addChecklistItem,
    removeChecklistItem,
    resetChecklistToAi,
    hasAiSuggestion,
    selectAllChecklist,
    clearAllChecklist,
    isReviewing,
    onRunReview,
    docReady,
    suggestingChecklist,
    onOpenMyDocs,
    onOpenProgressHistory,
    className,
  } = props;

  const { t } = useTranslation();
  const [customItemLabel, setCustomItemLabel] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const step2Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (docReady) {
      step2Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [docReady]);

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);
  const docFileRef = useRef<HTMLInputElement>(null);
  const templateFileRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

  const uploadMutation = useMutation({
    mutationFn: async (vars: { files: File[]; target: "doc" | "template" }) => {
      for (const f of vars.files) {
        if (f.size > MAX_FILE_SIZE) {
          const err = new Error("FILE_TOO_LARGE") as Error & { fileName: string };
          err.fileName = f.name;
          throw err;
        }
      }
      const form = new FormData();
      for (const f of vars.files) form.append("files", f);
      const docs = await documentsApi.upload(form);
      return { docs, target: vars.target };
    },
    onSuccess: ({ docs, target }) => {
      queryClient.invalidateQueries({ queryKey: ["review-documents"] });
      if (target === "doc") {
        setSelectedDoc({ id: docs[0].id, name: docs[0].original_filename ?? docs[0].title ?? docs[0].id });
        toast.success(
          docs.length > 1
            ? t("review.wizard.uploadedFiles", { count: docs.length })
            : t("review.wizard.uploadedFile", { name: docs[0].original_filename })
        );
      } else {
        setCompareDocIds((prev) => [...prev.filter((id) => id !== docs[0].id), docs[0].id]);
        toast.success(t("review.wizard.uploadedTemplate", { name: docs[0].original_filename }));
      }
    },
    onError: (error: unknown) => {
      const e = error as Error & { fileName?: string; response?: { status: number } };
      if (e.message === "FILE_TOO_LARGE") {
        toast.error(t("review.wizard.fileTooLarge", { name: e.fileName }));
      } else if (e.response?.status === 413) {
        toast.error(t("review.wizard.fileTooLargeServer"));
      } else {
        toast.error(t("review.wizard.uploadFailed"));
      }
    },
  });

  const compareDocs = documents.filter((d) => d.id !== selectedDoc?.id);
  const step1Done = !!selectedDoc;
  const step2Done = !compareEnabled || compareDocIds.length > 0;
  const step3Done = !!reviewType;
  const step4Done = checklist.some((c) => c.checked);
  // Checklist is advisory — review is allowed even when nothing is selected (TC#16)
  const step5Active = step1Done && step2Done && step3Done;

  const toggleCompareDoc = useCallback((docId: string) => {
    setCompareDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  }, [setCompareDocIds]);

  const removeCompareDoc = useCallback((docId: string) => {
    setCompareDocIds((prev) => prev.filter((id) => id !== docId));
  }, [setCompareDocIds]);

  const toggleReferenceDoc = useCallback((docId: string) => {
    setReferenceDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  }, [setReferenceDocIds]);

  const removeReferenceDoc = useCallback((docId: string) => {
    setReferenceDocIds((prev) => prev.filter((id) => id !== docId));
  }, [setReferenceDocIds]);

  const reviewTypes: ReviewType[] = ["Legal", "Business", "Financial", "Admin", "Compliance", "Custom"];

  return (
    <div className={cn("border-border bg-card flex h-full min-h-0 w-[clamp(280px,26vw,360px)] flex-shrink-0 flex-col overflow-x-hidden border-r", className)}>
      <div className="border-border flex items-center justify-between gap-2 border-b px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="border-brand-100 bg-brand-50 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border">
            <FileSearch className="text-brand-600 h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-foreground text-sm font-bold leading-tight">
              {t("review.wizard.setupTitle")}
            </h2>
            <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
              {t("review.wizard.setupSubtitle")}
            </p>
          </div>
        </div>
        {selectedDoc ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/60 h-7 flex-shrink-0 gap-1.5 rounded-lg px-2 text-xs"
            onClick={onOpenProgressHistory}
          >
            <History className="h-3.5 w-3.5" />
            {t("review.wizard.progressHistoryButton")}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/60 h-7 flex-shrink-0 gap-1.5 rounded-lg px-2 text-xs"
            onClick={onOpenMyDocs}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("review.wizard.myDocsButton")}
          </Button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {/* `!block` overrides Radix's forced `display:table` on the direct ScrollArea child,
            which otherwise expands the content beyond the container width. */}
        <div className="!block w-full max-w-full space-y-4 overflow-x-hidden p-4">
          {/* ─── STEP 1: Select Document ─── */}
          <div>
            <StepLabel
              step={1}
              label={t("review.wizard.selectDocStep")}
              done={step1Done}
              active={!step1Done}
            />

            <div className="border-border bg-muted/30 mb-2 grid grid-cols-3 overflow-hidden rounded-lg border text-xs">
              {(
                [
                  ["drive", t("review.wizard.sourceDrive"), FolderOpen],
                  ["upload", t("review.wizard.sourceUpload"), Upload],
                  ["url", t("review.wizard.sourceUrl"), LinkIcon],
                ] as [string, string, typeof FolderOpen][]
              ).map(([src, label, Icon]) => (
                <button
                  key={src}
                  onClick={() => setDocSource(src as DocSource)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 truncate px-1 py-2 transition-colors",
                    docSource === src
                      ? "bg-brand-500 font-bold text-white shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground font-medium",
                  )}
                >
                  <Icon className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>

            {docSource === "drive" && (
              <div className="max-h-[280px] space-y-1 overflow-x-hidden overflow-y-auto pr-1">
                {documents.length === 0 && (
                  <div className="text-muted-foreground px-2 py-2 text-xs italic">
                    {t("review.wizard.noDocsInDrive")}
                  </div>
                )}
                {documents.map((d) => {
                  const isActive = selectedDoc?.id === d.id;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setSelectedDoc(d)}
                      title={d.name}
                      className={cn(
                        "group w-full overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-all",
                        isActive
                          ? "border-brand-400 bg-brand-50 shadow-sm"
                          : "border-border hover:border-brand-200 hover:bg-muted/40",
                      )}
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        <FileText
                          className={cn(
                            "mt-0.5 h-4 w-4 flex-shrink-0",
                            isActive ? "text-brand-600" : "text-muted-foreground",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "line-clamp-2 break-all text-[13px] font-semibold leading-snug",
                              isActive ? "text-brand-700" : "text-foreground",
                            )}
                          >
                            {d.name}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-muted-foreground shrink-0 text-[11px]">
                              {d.date ?? ""}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 text-[11px] font-semibold",
                                d.reviewed
                                  ? "text-emerald-600"
                                  : "text-muted-foreground/70",
                              )}
                            >
                              {d.reviewed ? t("review.wizard.reviewed") : t("review.wizard.newDoc")}
                            </span>
                          </div>
                        </div>
                        {isActive && (
                          <div className="bg-brand-500 mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full">
                            <Check className="h-2.5 w-2.5 text-white" />
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {docSource === "upload" && (
              <>
                <input
                  ref={docFileRef}
                  type="file"
                  accept=".docx,.doc,.pdf,.txt"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length) uploadMutation.mutate({ files, target: "doc" });
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 border-dashed text-xs"
                  disabled={uploadMutation.isPending}
                  onClick={() => docFileRef.current?.click()}
                >
                  {uploadMutation.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t("review.wizard.uploading")}
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5" /> {t("review.wizard.uploadDocument")}
                    </>
                  )}
                </Button>
                {selectedDoc && (
                  <div className="text-muted-foreground mt-2 break-all text-xs leading-snug">
                    {t("review.wizard.selectedDoc", { name: selectedDoc.name })}
                  </div>
                )}
              </>
            )}

            {docSource === "url" && (
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder={t("review.wizard.urlPlaceholder")}
                className="border-border bg-background text-foreground focus:ring-brand-500 w-full rounded-lg border px-2.5 py-1.5 text-[13px] focus:ring-1 focus:outline-none"
              />
            )}
          </div>

          <div className="bg-border/40 mx-1 h-px" />

          {/* ─── STEP 2: Compare with Template ─── */}
          <div
            ref={step2Ref}
            className={cn(
              "transition-opacity",
              step1Done ? "opacity-100" : "pointer-events-none opacity-40",
            )}
          >
            <StepLabel
              step={2}
              label={t("review.wizard.compareTemplateStep")}
              done={step2Done && compareEnabled}
              active={step1Done && !step2Done}
            />

            <button
              onClick={() => setCompareEnabled((v) => !v)}
              className={cn(
                "mb-2 flex w-full items-center justify-between rounded-lg border px-3 py-2.5 transition-all",
                compareEnabled
                  ? "border-brand-400 bg-brand-50 shadow-sm"
                  : "border-border hover:border-brand-200 hover:bg-muted/40",
              )}
            >
              <div className="flex items-center gap-2">
                <GitCompare className={cn(
                  "h-3.5 w-3.5 flex-shrink-0",
                  compareEnabled ? "text-brand-600" : "text-muted-foreground",
                )} />
                <span className={cn(
                  "text-[13px] font-semibold",
                  compareEnabled ? "text-brand-700" : "text-foreground",
                )}>
                  {t("review.wizard.enableCompare")}
                </span>
              </div>
              {compareEnabled ? (
                <ToggleRight className="text-brand-500 h-5 w-5" />
              ) : (
                <ToggleLeft className="text-muted-foreground/60 h-5 w-5" />
              )}
            </button>

            {compareEnabled && (
              <div className="border-brand-200 bg-brand-50/70 space-y-3 rounded-lg border p-3">
                {/* Current document */}
                <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5">
                  <div className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                  <span className="text-xs font-semibold text-blue-700">
                    {t("review.wizard.compareCurrentLabel")}
                  </span>
                  <span className="break-all text-xs leading-snug text-blue-600">
                    {selectedDoc?.name ?? "—"}
                  </span>
                </div>

                <ArrowRight className="text-muted-foreground mx-auto h-3 w-3" />

                {/* Selected compare docs — chips */}
                {compareDocIds.length > 0 && (
                  <div className="space-y-1">
                    {compareDocIds.map((cid) => {
                      const docName = documents.find((d) => d.id === cid)?.name ?? cid;
                      return (
                        <div key={cid} className="flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2 py-1.5">
                          <div className="h-2 w-2 flex-shrink-0 rounded-full bg-violet-500" />
                          <span className="min-w-0 flex-1 break-all text-xs leading-snug text-violet-700 font-semibold">
                            {docName}
                          </span>
                          <button
                            onClick={() => removeCompareDoc(cid)}
                            title={t("review.wizard.removeCompareFile")}
                            className="text-violet-400 hover:text-red-500 flex-shrink-0 transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                    <div className="text-brand-600 flex items-center gap-1.5 text-[11px] font-semibold">
                      <GitCompare className="h-3 w-3" />
                      {t("review.wizard.compareFilesCount", { count: compareDocIds.length })}
                    </div>
                  </div>
                )}

                {/* Source tab: Drive / Upload */}
                <div className="border-border flex overflow-hidden rounded-md border text-xs">
                  {(
                    [
                      ["drive", t("review.wizard.fromDrive")],
                      ["upload", t("review.wizard.sourceUpload")],
                    ] as [string, string][]
                  ).map(([src, label]) => (
                    <button
                      key={src}
                      onClick={() => setTemplateSource(src as "drive" | "upload")}
                      className={cn(
                        "flex-1 py-1.5 transition-colors",
                        templateSource === src
                          ? "bg-brand-500 font-semibold text-white"
                          : "text-muted-foreground hover:bg-muted/60 font-medium",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Drive picker — multi-select via toggle */}
                {templateSource === "drive" ? (
                  <div className="max-h-[200px] space-y-1.5 overflow-y-auto pr-1">
                    {compareDocs.length === 0 && (
                      <div className="text-muted-foreground px-2 py-2 text-xs italic">
                        {t("review.wizard.noTemplatesAvailable")}
                      </div>
                    )}
                    {compareDocs.map((d) => {
                      const isSelected = compareDocIds.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          onClick={() => toggleCompareDoc(d.id)}
                          className={cn(
                            "w-full overflow-hidden rounded-lg border px-3 py-2 text-left transition-all",
                            isSelected
                              ? "border-violet-500 bg-violet-50 shadow-sm"
                              : "border-border hover:border-violet-300 hover:bg-muted/50",
                          )}
                        >
                          <div className="flex min-w-0 items-start gap-2">
                            <div className={cn(
                              "mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2",
                              isSelected ? "border-violet-500 bg-violet-500" : "border-border",
                            )}>
                              {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                            </div>
                            <div className={cn(
                              "min-w-0 flex-1 truncate text-xs font-semibold",
                              isSelected ? "text-violet-700" : "text-foreground",
                            )}>
                              {d.name}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    <input
                      ref={templateFileRef}
                      type="file"
                      accept=".docx,.doc,.pdf,.txt"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          uploadMutation.mutate({ files: [file], target: "template" });
                        e.target.value = "";
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2 border-dashed text-xs"
                      disabled={uploadMutation.isPending}
                      onClick={() => templateFileRef.current?.click()}
                    >
                      {uploadMutation.isPending ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t("review.wizard.uploading")}
                        </>
                      ) : (
                        <>
                          <Upload className="h-3.5 w-3.5" /> {t("review.wizard.addCompareFile")}
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="bg-border/40 mx-1 h-px" />

          {/* ─── STEP 2b: Tham chiếu nội bộ ─── */}
          <div
            className={cn(
              "transition-opacity",
              step1Done ? "opacity-100" : "pointer-events-none opacity-40",
            )}
          >
            <StepLabel
              step={2}
              label={t("review.wizard.referenceStep")}
              done={referenceEnabled && referenceDocIds.length > 0}
              active={step1Done && referenceEnabled && referenceDocIds.length === 0}
            />

            <button
              onClick={() => setReferenceEnabled((v) => !v)}
              className={cn(
                "mb-2 flex w-full items-center justify-between rounded-lg border px-3 py-2.5 transition-all",
                referenceEnabled
                  ? "border-blue-400 bg-blue-50 shadow-sm"
                  : "border-border hover:border-blue-200 hover:bg-muted/40",
              )}
            >
              <div className="flex items-center gap-2">
                <BookOpen className={cn("h-3.5 w-3.5 flex-shrink-0", referenceEnabled ? "text-blue-600" : "text-muted-foreground")} />
                <span className={cn("text-[13px] font-semibold", referenceEnabled ? "text-blue-700" : "text-foreground")}>
                  {t("review.wizard.enableReference")}
                </span>
              </div>
              {referenceEnabled ? (
                <ToggleRight className="text-blue-500 h-5 w-5" />
              ) : (
                <ToggleLeft className="text-muted-foreground/60 h-5 w-5" />
              )}
            </button>

            {referenceEnabled && (
              <div className="border-blue-200 bg-blue-50/70 space-y-3 rounded-lg border p-3">
                {/* Selected reference docs */}
                {referenceDocIds.length > 0 && (
                  <div className="space-y-1">
                    {referenceDocIds.map((rid) => {
                      const docName = documents.find((d) => d.id === rid)?.name ?? rid;
                      return (
                        <div key={rid} className="flex items-center gap-1.5 rounded-md border border-blue-200 bg-white px-2 py-1.5">
                          <BookOpen className="h-3 w-3 flex-shrink-0 text-blue-500" />
                          <span className="min-w-0 flex-1 break-all text-xs font-semibold leading-snug text-blue-700">
                            {docName}
                          </span>
                          <button
                            onClick={() => removeReferenceDoc(rid)}
                            title={t("review.wizard.removeCompareFile")}
                            className="text-blue-300 hover:text-red-500 flex-shrink-0 transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Drive multi-select for reference docs */}
                <div className="max-h-[180px] space-y-1.5 overflow-y-auto pr-1">
                  {documents.filter((d) => d.id !== selectedDoc?.id).length === 0 && (
                    <div className="text-muted-foreground px-2 py-2 text-xs italic">
                      {t("review.wizard.noDocsInDrive")}
                    </div>
                  )}
                  {documents.filter((d) => d.id !== selectedDoc?.id).map((d) => {
                    const isSelected = referenceDocIds.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        onClick={() => toggleReferenceDoc(d.id)}
                        className={cn(
                          "w-full overflow-hidden rounded-lg border px-3 py-2 text-left transition-all",
                          isSelected
                            ? "border-blue-400 bg-blue-50 shadow-sm"
                            : "border-border hover:border-blue-200 hover:bg-muted/50",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <div className={cn(
                            "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2",
                            isSelected ? "border-blue-500 bg-blue-500" : "border-border",
                          )}>
                            {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                          </div>
                          <span className={cn("min-w-0 flex-1 truncate text-xs font-semibold", isSelected ? "text-blue-700" : "text-foreground")}>
                            {d.name}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Reference content textarea */}
                <div>
                  <label className="text-blue-700 mb-1 block text-[11px] font-semibold">
                    {t("review.wizard.referenceContent")}
                  </label>
                  <textarea
                    value={referenceContent}
                    onChange={(e) => setReferenceContent(e.target.value)}
                    placeholder={t("review.wizard.referenceContentPlaceholder")}
                    rows={2}
                    className="border-blue-200 bg-white text-foreground placeholder:text-muted-foreground/50 focus:ring-blue-300 focus:border-blue-300 w-full resize-none rounded-lg border px-2.5 py-2 text-[13px] transition-colors focus:ring-1 focus:outline-none"
                  />
                </div>

                {referenceDocIds.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600">
                    <BookOpen className="h-3 w-3" />
                    {t("review.wizard.referenceFilesCount", { count: referenceDocIds.length })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-border/40 mx-1 h-px" />

          {/* ─── STEP 3: Review Type ─── */}
          <div
            className={cn(
              "transition-opacity",
              step1Done && step2Done
                ? "opacity-100"
                : "pointer-events-none opacity-40",
            )}
          >
            <StepLabel
              step={3}
              label={t("review.wizard.reviewTypeStep")}
              done={step3Done}
              active={step1Done && step2Done && !step3Done}
            />

            <div className="grid grid-cols-2 gap-1.5">
              {reviewTypes.map((type) => {
                const meta = REVIEW_TYPE_META[type];
                const isSelected = reviewType === type;
                return (
                  <button
                    key={type}
                    onClick={() => onReviewTypeChange(type)}
                    className={cn(
                      "rounded-lg border px-2.5 py-2.5 text-left transition-all",
                      isSelected
                        ? "border-brand-500 bg-brand-500 shadow-sm"
                        : "border-border hover:border-brand-300 hover:bg-muted/40",
                    )}
                  >
                    <div
                      className={cn(
                        "text-xs font-bold leading-tight",
                        isSelected ? "text-white" : "text-foreground",
                      )}
                    >
                      {t(`review.reviewType.${type}.label` as never, { defaultValue: meta.label })}
                    </div>
                    <div className={cn(
                      "mt-0.5 text-[11px] leading-tight",
                      isSelected ? "text-white/90" : "text-foreground/55",
                    )}>
                      {t(`review.reviewType.${type}.description` as never, { defaultValue: meta.description })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-border/40 mx-1 h-px" />

          {/* ─── STEP 4: Checklist ─── */}
          <div
            className={cn(
              "transition-opacity",
              step1Done && step2Done && step3Done
                ? "opacity-100"
                : "pointer-events-none opacity-40",
            )}
          >
            {/* Header: StepLabel + action buttons */}
            <div className="mb-1.5 flex items-center justify-between">
              <StepLabel
                step={4}
                label={t("review.wizard.checklistStep")}
                done={step4Done}
                active={step1Done && step2Done && step3Done && !step4Done}
              />
              <div className="flex items-center gap-0.5">
                {selectAllChecklist && (
                  <button
                    onClick={selectAllChecklist}
                    title={t("review.wizard.selectAll")}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors"
                  >
                    <CheckSquare className="h-3 w-3" />
                    {t("review.wizard.selectAll")}
                  </button>
                )}
                {clearAllChecklist && (
                  <button
                    onClick={clearAllChecklist}
                    title={t("review.wizard.selectNone")}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors"
                  >
                    <Square className="h-3 w-3" />
                    {t("review.wizard.selectNone")}
                  </button>
                )}
                {resetChecklistToAi && (
                  <button
                    onClick={resetChecklistToAi}
                    disabled={!hasAiSuggestion}
                    title={hasAiSuggestion ? t("review.wizard.resetChecklistToAi") : t("review.wizard.noAiSuggestionYet")}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Sparkles className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Grouped checklist */}
            <ChecklistGrouped
              items={checklist}
              collapsedCategories={collapsedCategories}
              toggleCategory={toggleCategory}
              toggleChecklistItem={toggleChecklistItem}
              toggleCategoryItems={toggleCategoryItems}
              removeChecklistItem={removeChecklistItem}
            />

            {/* Add custom item */}
            {addChecklistItem && (
              <div className="mt-2.5 flex items-center gap-1.5">
                <input
                  type="text"
                  value={customItemLabel}
                  onChange={(e) => setCustomItemLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customItemLabel.trim()) {
                      addChecklistItem(customItemLabel.trim());
                      setCustomItemLabel("");
                    }
                  }}
                  placeholder={t("review.wizard.addChecklistItem")}
                  className="border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:ring-brand-400 focus:border-brand-400 flex-1 rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors focus:ring-1 focus:outline-none"
                />
                <button
                  onClick={() => {
                    if (customItemLabel.trim()) {
                      addChecklistItem(customItemLabel.trim());
                      setCustomItemLabel("");
                    }
                  }}
                  disabled={!customItemLabel.trim()}
                  className="border-border hover:bg-muted/60 hover:border-brand-300 rounded-lg border p-1.5 transition-colors disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {REVIEW_CHECKLISTS[reviewType].length === 0 && checklist.length === 0 && (
              <p className="text-muted-foreground text-xs italic">
                {t("review.wizard.noDefaultChecklist")}
              </p>
            )}
          </div>

          <div className="bg-border/40 mx-1 h-px" />

          {/* ─── STEP 5: Review Action ─── */}
          <div>
            <StepLabel
              step={5}
              label={t("review.wizard.actionStep")}
              done={false}
              active={step5Active}
            />

            {suggestingChecklist && (
              <div className="text-brand-600 mb-2 flex items-center gap-1.5 text-[11px] font-semibold">
                <Sparkles className="h-3 w-3 animate-pulse" />
                {t("review.wizard.suggestingChecklist")}
              </div>
            )}

            <div className="mb-2.5">
              <label className="text-muted-foreground mb-1 block text-[11px] font-semibold uppercase tracking-wide">
                {t("review.wizard.additionalRequirements")}
              </label>
              <textarea
                value={additionalRequirements}
                onChange={(e) => setAdditionalRequirements(e.target.value)}
                placeholder={t("review.wizard.additionalRequirementsPlaceholder")}
                rows={3}
                className="border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:ring-brand-400 focus:border-brand-400 w-full resize-none rounded-lg border px-2.5 py-2 text-[13px] transition-colors focus:ring-1 focus:outline-none"
              />
            </div>

            <Button
              size="sm"
              className="bg-brand-500 hover:bg-brand-600 h-9 w-full gap-2 text-[13px] font-bold text-white shadow-sm transition-all"
              disabled={!step5Active || isReviewing}
              onClick={onRunReview}
            >
              {isReviewing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("review.wizard.analyzing")}
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-white" />
                  {t("review.wizard.runReview")}
                </>
              )}
            </Button>
          </div>
        </div>
      </ScrollArea>

    </div>
  );
}
