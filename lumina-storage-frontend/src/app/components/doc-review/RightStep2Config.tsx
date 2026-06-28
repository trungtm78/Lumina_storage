import { type Dispatch, type SetStateAction, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ListChecks, GitCompare, Layers, Plus, X, Sparkles,
  Loader2, CheckSquare, Square, FileText
} from "lucide-react";
import { Switch } from "@/app/components/ui/switch";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Button } from "@/app/components/ui/button";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { cn } from "@/app/components/ui/utils";
import {
  REVIEW_CHECKLISTS,
  REVIEW_TYPE_META,
  type ReviewChecklistItem,
  type ReviewType,
} from "@/app/api/endpoints/review";


interface ReviewDocItem {
  id: string;
  name: string;
  date?: string;
}

export interface RightStep2ConfigProps {
  // Review type
  reviewType: ReviewType;
  onReviewTypeChange: (type: ReviewType) => void;

  // Compare
  compareEnabled: boolean;
  setCompareEnabled: Dispatch<SetStateAction<boolean>>;
  compareDocIds: string[];
  setCompareDocIds: Dispatch<SetStateAction<string[]>>;
  onOpenCompareFilePicker: () => void;

  // Reference
  referenceEnabled: boolean;
  setReferenceEnabled: Dispatch<SetStateAction<boolean>>;
  referenceDocIds: string[];
  setReferenceDocIds: Dispatch<SetStateAction<string[]>>;
  referenceContent: string;
  setReferenceContent: Dispatch<SetStateAction<string>>;
  onOpenReferenceFilePicker: () => void;

  // Checklist
  checklist: ReviewChecklistItem[];
  toggleChecklistItem: (id: string) => void;
  toggleCategoryItems: (category: string, checked: boolean) => void;
  resetChecklistToAi: () => void;
  hasAiSuggestion: boolean;
  selectAllChecklist: () => void;
  clearAllChecklist: () => void;

  // Additional requirements
  additionalRequirements: string;
  setAdditionalRequirements: Dispatch<SetStateAction<string>>;

  // Actions
  isReviewing: boolean;
  suggestingChecklist: boolean;
  onTriggerAiSuggest?: () => void;
  onStartReview: () => void;

  // Context — to display selected file names
  documents: ReviewDocItem[];
}

// ─── Small helpers ─────────────────────────────────────────────────────────

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1 mb-2">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
        {title}
      </p>
      {hint && <p className="text-[9px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

// FileKindIcon — khớp design: colored box w-8 h-8, icon w-3.5 h-3.5 bên trong
function fileIconColor(name: string) {
  const ext = name.split(".").pop()?.toUpperCase() ?? "DOC";
  if (ext === "PDF") return "text-red-600 bg-red-50";
  if (ext === "XLSX" || ext === "XLS") return "text-emerald-600 bg-emerald-50";
  return "text-blue-600 bg-blue-50";
}

function FileChip({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) {
  return (
    // Design: flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-card
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-card">
      {/* FileKindIcon: w-8 h-8 rounded-md, FileText w-3.5 h-3.5 */}
      <div className={cn("rounded-md flex items-center justify-center w-8 h-8 flex-shrink-0", fileIconColor(name))}>
        <FileText className="w-3.5 h-3.5" />
      </div>
      {/* text-xs flex-1 truncate */}
      <span className="text-xs flex-1 truncate">{name}</span>
      {/* X: text-muted-foreground hover:text-destructive, w-3.5 h-3.5 */}
      <button
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive flex-shrink-0 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

const CATEGORY_ORDER = [
  "Format", "Thông tin", "Pháp lý", "Nghĩa vụ", "Quyền lợi",
  "Thanh toán", "Phạt vi phạm", "Thời hạn", "Rủi ro", "Tóm tắt", "So sánh",
] as const;

interface ChecklistGroupedProps {
  items: ReviewChecklistItem[];
  toggleChecklistItem: (id: string) => void;
  toggleCategoryItems: (category: string, checked: boolean) => void;
}

function ChecklistGrouped({
  items,
  toggleChecklistItem,
  toggleCategoryItems,
}: ChecklistGroupedProps) {
  const { t } = useTranslation();
  // Loại bỏ "So sánh" — handled bởi compare toggle riêng
  const filteredItems = items.filter((item) => item.category !== "So sánh");

  // Group by category
  const groups = filteredItems.reduce<Record<string, ReviewChecklistItem[]>>((acc, item) => {
    const cat = item.category ?? "Khác";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const sortedCats = [
    ...CATEGORY_ORDER.filter((c) => groups[c]),
    ...Object.keys(groups).filter((c) => !CATEGORY_ORDER.includes(c as typeof CATEGORY_ORDER[number])),
  ];

  if (sortedCats.length === 0) return null;

  // Flat list nếu không có category
  const hasCats = filteredItems.some((i) => i.category);
  if (!hasCats) {
    return (
      <div className="space-y-1">
        {filteredItems.map((item) => (
          <ChecklistRow key={item.id} item={item} onToggle={toggleChecklistItem} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sortedCats.map((cat) => {
        const catItems = groups[cat];
        const checkedCount = catItems.filter((i) => i.checked).length;
        const allChecked = checkedCount === catItems.length;
        const someChecked = checkedCount > 0 && !allChecked;

        return (
          // rounded-md border border-border overflow-hidden — khớp design
          <div key={cat} className="rounded-md border border-border overflow-hidden">

            {/*
              Group header — label element (click = toggle group checkbox)
              px-3 py-1.5 bg-muted/40 flex items-center gap-2 cursor-pointer select-none
            */}
            <label className="px-3 py-1.5 bg-muted/40 flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                onCheckedChange={() => toggleCategoryItems(cat, !allChecked)}
              />
              {/* text-[11px] font-semibold text-foreground uppercase tracking-wider flex-1 */}
              <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex-1">
                {t(`review.category.${cat}` as never, { defaultValue: cat })}
              </span>
              {/* text-[10px] text-muted-foreground */}
              <span className="text-[10px] text-muted-foreground">
                {checkedCount}/{catItems.length}
              </span>
            </label>

            {/* Items container: p-2 space-y-1 — khớp design */}
            <div className="p-2 space-y-1">
              {catItems.map((item) => (
                <ChecklistRow key={item.id} item={item} onToggle={toggleChecklistItem} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChecklistRow({
  item,
  onToggle,
}: {
  item: ReviewChecklistItem;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const label = t(`review.checklist.${item.id}.label` as never, { defaultValue: item.label });
  const description = item.description
    ? t(`review.checklist.${item.id}.description` as never, { defaultValue: item.description })
    : undefined;
  return (
    <label className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/50 cursor-pointer">
      <Checkbox
        checked={item.checked}
        onCheckedChange={() => onToggle(item.id)}
      />
      <span className="min-w-0 flex-1 text-xs text-foreground leading-snug" title={description}>
        {label}
      </span>
    </label>
  );
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────

export function RightStep2Config({
  reviewType,
  onReviewTypeChange,
  compareEnabled,
  setCompareEnabled,
  compareDocIds,
  setCompareDocIds,
  onOpenCompareFilePicker,
  referenceEnabled,
  setReferenceEnabled,
  referenceDocIds,
  setReferenceDocIds,
  referenceContent,
  setReferenceContent,
  onOpenReferenceFilePicker,
  checklist,
  toggleChecklistItem,
  toggleCategoryItems,
  resetChecklistToAi,
  hasAiSuggestion,
  selectAllChecklist,
  clearAllChecklist,
  additionalRequirements,
  setAdditionalRequirements,
  isReviewing,
  suggestingChecklist,
  onTriggerAiSuggest,
  onStartReview,
  documents,
}: RightStep2ConfigProps) {
  const { t } = useTranslation();

  const REVIEW_TYPES: ReviewType[] = ["Legal", "Business", "Financial", "Admin", "Compliance", "Custom"];

  const docName = (id: string) =>
    documents.find((d) => d.id === id)?.name ?? id;

  const removeCompareDoc = useCallback(
    (id: string) => setCompareDocIds((prev) => prev.filter((x) => x !== id)),
    [setCompareDocIds]
  );

  const removeReferenceDoc = useCallback(
    (id: string) => setReferenceDocIds((prev) => prev.filter((x) => x !== id)),
    [setReferenceDocIds]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center gap-3 flex-shrink-0">
        <div className="w-8 h-8 rounded-md bg-brand-50 flex items-center justify-center flex-shrink-0">
          <ListChecks className="w-4 h-4 text-brand-600" />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            {t("review.wizard.stepTwo")}
          </p>
          <p className="text-sm font-semibold text-foreground">{t("review.wizard.stepTwoTitle")}</p>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        {isReviewing && (
          <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2 rounded-sm">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <p className="text-xs font-medium text-muted-foreground">{t("review.wizard.analyzing")}</p>
          </div>
        )}
      <ScrollArea className="h-full">
        <div className={cn("p-5 space-y-6", isReviewing && "pointer-events-none select-none")}>

          {/* ── Loại review ── */}
          <div>
            <SectionHeader title={t("review.wizard.sectionReviewType")} />
            <div className="grid grid-cols-2 gap-2">
              {REVIEW_TYPES.map((type) => {
                const meta = REVIEW_TYPE_META[type];
                const active = reviewType === type;
                return (
                  <button
                    key={type}
                    onClick={() => onReviewTypeChange(type)}
                    className={cn(
                      "text-xs px-3 py-2.5 rounded-md border text-left transition-colors",
                      active
                        ? "border-brand-500 bg-brand-500 text-white"
                        : "border-border bg-card hover:bg-muted/60 text-foreground"
                    )}
                  >
                    <div className={cn("font-semibold leading-tight", active ? "text-white" : "")}>
                      {t(`review.reviewType.${type}.label` as never, { defaultValue: meta.label })}
                    </div>
                    <div className={cn("text-[10px] mt-0.5 leading-tight", active ? "text-white/80" : "text-foreground/50")}>
                      {t(`review.reviewType.${type}.description` as never, { defaultValue: meta.description })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── So sánh & Tham chiếu ── */}
          <div>
            <SectionHeader title={t("review.wizard.sectionCompareRef")} />
            <div className="space-y-2">

              {/* Block 1: So sánh */}
              <div className="rounded-md border border-border overflow-hidden">
                <div className="flex items-center justify-between p-3 bg-muted/20">
                  <div className="flex items-center gap-2.5">
                    <GitCompare className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{t("review.wizard.enableCompare")}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t("review.wizard.compareHint")}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={compareEnabled}
                    onCheckedChange={setCompareEnabled}
                  />
                </div>
                
                {compareEnabled && (
                  <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border">
                    {compareDocIds.map((id) => (
                      <FileChip
                        key={id}
                        name={docName(id)}
                        onRemove={() => removeCompareDoc(id)}
                      />
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5 h-8 text-xs"
                      onClick={onOpenCompareFilePicker}
                    >
                      <Plus className="w-3.5 h-3.5" /> {t("review.wizard.addCompareFileBtn")}
                    </Button>
                  </div>
                )}
              </div>

              {/* Block 2: Tham chiếu nội bộ */}
              <div className="rounded-md border border-border overflow-hidden">
                <div className="flex items-center justify-between p-3 bg-muted/20">
                  <div className="flex items-center gap-2.5">
                    <Layers className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{t("review.wizard.enableReference")}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t("review.wizard.referenceHint")}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={referenceEnabled}
                    onCheckedChange={setReferenceEnabled}
                  />
                </div>
                {referenceEnabled && (
                  <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border">
                    {referenceDocIds.map((id) => (
                      <FileChip
                        key={id}
                        name={docName(id)}
                        onRemove={() => removeReferenceDoc(id)}
                      />
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5 h-8 text-xs"
                      onClick={onOpenReferenceFilePicker}
                    >
                      <Plus className="w-3.5 h-3.5" /> {t("review.wizard.addReferenceFile")}
                    </Button>
                    <div className="pt-1">
                      <p className="text-[11px] text-muted-foreground mb-1">
                        {t("review.wizard.referenceContentLabel")}
                      </p>
                      <textarea
                        value={referenceContent}
                        onChange={(e) => setReferenceContent(e.target.value)}
                        className="border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:ring-brand-400 focus:border-brand-400 w-full resize-none rounded-md border px-2.5 py-2 text-xs transition-colors focus:ring-1 focus:outline-none"
                        rows={2}
                        placeholder={t("review.wizard.referenceContentPlaceholder")}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Checklist đề xuất từ AI ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <SectionHeader title={t("review.wizard.checklistFromAi")} hint={t("review.wizard.checklistHint")} />
              <div className="flex items-center gap-0.5 ml-0.5">
                <button
                  onClick={selectAllChecklist}
                  title={t("review.wizard.selectAll")}
                  className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
                >
                  <CheckSquare className="h-3 w-3" />
                </button>
                <button
                  onClick={clearAllChecklist}
                  title={t("review.wizard.deselectAll")}
                  className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
                >
                  <Square className="h-3 w-3" />
                </button>
                <button
                  onClick={hasAiSuggestion ? resetChecklistToAi : onTriggerAiSuggest}
                  disabled={suggestingChecklist || (!hasAiSuggestion && !onTriggerAiSuggest)}
                  title={
                    suggestingChecklist
                      ? t("review.wizard.aiSuggesting")
                      : hasAiSuggestion
                        ? t("review.wizard.resetChecklistToAi")
                        : t("review.wizard.retryAiSuggest")
                  }
                  className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Sparkles className={`h-3 w-3 ${suggestingChecklist ? "animate-pulse" : ""}`} />
                </button>
              </div>
            </div>

            {/* AI suggesting indicator*/}
            {suggestingChecklist && (
              <div className="text-brand-600 mb-2 flex items-center gap-1.5 text-[11px] font-semibold">
                <Sparkles className="h-3 w-3 animate-pulse" />
                {t("review.wizard.aiSuggesting")}
              </div>
            )}

            <ChecklistGrouped
              items={checklist}
              toggleChecklistItem={toggleChecklistItem}
              toggleCategoryItems={toggleCategoryItems}
            />

            {REVIEW_CHECKLISTS[reviewType].length === 0 && checklist.length === 0 && (
              <p className="text-muted-foreground text-xs italic mt-2">
                {t("review.wizard.checklistEmpty")}
              </p>
            )}
          </div>

          {/* ── Yêu cầu thêm cho AI ── */}
          <div>
            <SectionHeader
              title={t("review.wizard.sectionAdditional")}
              hint={t("review.wizard.sectionAdditionalHint")}
            />
            <p className="text-[11px] text-muted-foreground mb-1.5">
              {t("review.wizard.sectionAdditionalSubtitle")}
            </p>
            <textarea
              value={additionalRequirements}
              onChange={(e) => setAdditionalRequirements(e.target.value.slice(0, 800))}
              placeholder={t("review.wizard.additionalRequirementsPlaceholder")}
              rows={3}
              maxLength={800}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:ring-brand-400 focus:border-brand-400 w-full resize-none rounded-md border px-2.5 py-2 text-sm transition-colors focus:ring-1 focus:outline-none"
            />
            <div className="flex justify-end mt-0.5">
              <span className={cn(
                "text-[10px] tabular-nums",
                additionalRequirements.length >= 750 ? "text-amber-600 font-medium" : "text-muted-foreground/50"
              )}>
                {additionalRequirements.length}/800
              </span>
            </div>
          </div>
        </div>
      </ScrollArea>
      </div>

      {/* Start review button — fixed at bottom */}
      <div className="p-4 border-t border-border flex-shrink-0">
        <Button
          className="w-full gap-2 bg-primary hover:bg-primary/90 text-white font-bold"
          disabled={isReviewing}
          onClick={onStartReview}
        >
          {isReviewing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("review.wizard.analyzing")}
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              {t("review.wizard.runReview")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
