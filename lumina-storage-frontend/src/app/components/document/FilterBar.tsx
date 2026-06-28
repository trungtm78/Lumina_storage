import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  CheckIcon,
  X,
  Trash2,
  RotateCcw,
  RefreshCw,
  Grid3x3,
  List,
  CheckSquare,
} from "lucide-react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "@/app/components/ui/utils";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectItem,
  SelectValue,
} from "@/app/components/ui/select";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";

interface FilterBarProps {
  selectedType: string;
  selectedSort: string;
  selectedPerson: string;
  searchMode: "keyword" | "semantic";
  onTypeChange: (type: string) => void;
  onSortChange: (sort: string) => void;
  onPersonChange: (person: string) => void;
  onSearchChange: (q: string) => void;
  onSearchModeChange: (mode: "keyword" | "semantic") => void;
  availablePeople: string[];
  startDate?: string;
  endDate?: string;
  onStartDateChange?: (date: string) => void;
  onEndDateChange?: (date: string) => void;
  selectMode: boolean;
  selectedCount: number;
  isBulkDeleting?: boolean;
  onToggleSelectMode: () => void;
  onBulkDelete: () => void;
  onCancelSelect: () => void;
  selectedDocIds: Set<string>;
  setSelectMode: (selectMode: boolean) => void;
  handleCancelSelectMode: () => void;
  setShowBulkDeleteConfirm: (show: boolean) => void;
  bulkDelete: {
    isPending: boolean;
    error: string | null;
  };
  onResetFilters?: () => void;
  onReload?: () => void;
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
}

export function FilterBar({
  selectedType,
  selectedSort,
  searchMode,
  onTypeChange,
  onSortChange,
  onSearchChange,
  onSearchModeChange,
  startDate = "",
  endDate = "",
  onStartDateChange,
  onEndDateChange,
  selectMode: _selectMode,
  isBulkDeleting: _isBulkDeleting = false,
  onToggleSelectMode: _onToggleSelectMode,
  onBulkDelete: _onBulkDelete,
  onCancelSelect: _onCancelSelect,
  selectedDocIds,
  setSelectMode,
  handleCancelSelectMode,
  setShowBulkDeleteConfirm,
  bulkDelete,
  onResetFilters,
  onReload,
  viewMode,
  onViewModeChange,
}: FilterBarProps) {
  const { t } = useTranslation();
  const [localSearch, setLocalSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const typeOptions = useMemo(
    () => [
      { value: "all", label: t("documents.filterTypeAll") },
      { value: "folder", label: t("documents.folder") },
      { value: ".pdf", label: "PDF" },
      { value: ".docx", label: "Word (.docx)" },
      { value: ".xlsx", label: "Excel (.xlsx)" },
      { value: ".pptx", label: "PowerPoint (.pptx)" },
      { value: "image", label: t("documents.filterTypeImage") },
      { value: ".mp4", label: "Video (.mp4)" },
      { value: ".zip", label: "Archive (.zip)" },
    ],
    [t]
  );

  const sortOptions = useMemo(
    () => [
      { value: "updated_at:desc", label: t("documents.sortModifiedDesc") },
      { value: "updated_at:asc", label: t("documents.sortModifiedAsc") },
      { value: "created_at:desc", label: t("documents.sortCreatedDesc") },
      { value: "created_at:asc", label: t("documents.sortCreatedAsc") },
    ],
    [t]
  );

  const searchModeOptions = useMemo(
    () => [
      {
        value: "keyword",
        label: t("documents.searchModeKeyword"),
        desc: t("documents.searchModeKeywordDesc"),
      },
      {
        value: "semantic",
        label: t("documents.searchModeSemantic"),
        desc: t("documents.searchModeSemanticDesc"),
      },
    ],
    [t]
  );

  const handleSearchInput = useCallback(
    (value: string) => {
      setLocalSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearchChange(value);
      }, 400);
    },
    [onSearchChange]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const hasActiveFilters =
    selectedType !== "all" || startDate || endDate;

  return (
    <Card className="p-4">
      <div className="space-y-3">
        {/* Row 1: Search + Type + Sort + Search mode */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => handleSearchInput(e.target.value)}
              placeholder={t("documents.searchPlaceholder")}
              className="focus:border-brand-400 focus:ring-brand-400 h-9 w-full rounded-md border border-border bg-background pr-3 pl-9 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus:ring-1"
            />
          </div>

          {/* Search mode */}
          <Select
            value={searchMode}
            onValueChange={(v) => onSearchModeChange(v as "keyword" | "semantic")}
          >
            <SelectTrigger className="h-9 w-[130px] shrink-0" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-[280px]">
              {searchModeOptions.map((opt) => (
                <SelectPrimitive.Item
                  key={opt.value}
                  value={opt.value}
                  className={cn(
                    "relative flex w-full cursor-default items-center gap-2 rounded-sm py-2 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                    "focus:bg-accent focus:text-accent-foreground"
                  )}
                >
                  <span className="absolute right-2 flex size-3.5 items-center justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <CheckIcon className="size-4" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                  <span className="text-xs text-muted-foreground">{opt.desc}</span>
                </SelectPrimitive.Item>
              ))}
            </SelectContent>
          </Select>

          {/* Type */}
          <Select value={selectedType} onValueChange={onTypeChange}>
            <SelectTrigger className="h-9 w-[130px] shrink-0" size="sm">
              <SelectValue placeholder={t("common.type")} />
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select value={selectedSort} onValueChange={onSortChange}>
            <SelectTrigger className="h-9 w-[160px] shrink-0" size="sm">
              <SelectValue placeholder={t("documents.sort")} />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Row 2: Date range + (right) actions + view toggle */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Date range */}
          <input
            type="datetime-local"
            value={startDate}
            max={endDate || new Date().toISOString().slice(0, 16)}
            onChange={(e) => onStartDateChange?.(e.target.value)}
            title={t("documents.fromDate")}
            className="focus:border-brand-400 h-9 min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none"
          />
          <span className="shrink-0 text-sm text-muted-foreground">—</span>
          <input
            type="datetime-local"
            value={endDate}
            min={startDate || undefined}
            max={new Date().toISOString().slice(0, 16)}
            onChange={(e) => onEndDateChange?.(e.target.value)}
            title={t("documents.toDate")}
            className="focus:border-brand-400 h-9 min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none"
          />

          <div className="ml-auto flex items-center gap-2">
            {/* Reset filters */}
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLocalSearch("");
                  onResetFilters?.();
                }}
                title={t("documents.clearFilters")}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("documents.clearFilters")}</span>
              </Button>
            )}

            {/* Reload */}
            <Button variant="outline" size="sm" onClick={onReload}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              <span className="hidden sm:inline">{t("documents.reload")}</span>
            </Button>

            {/* Select / Bulk delete */}
            {_selectMode ? (
              <div className="flex items-center gap-2">
                {selectedDocIds.size > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowBulkDeleteConfirm(true)}
                    disabled={bulkDelete.isPending}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    <span className="hidden sm:inline">
                      {t("documents.selectToDelete")} ({selectedDocIds.size})
                    </span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelSelectMode}
                >
                  <X className="mr-1.5 h-4 w-4" />
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectMode(true)}
              >
                <CheckSquare className="mr-1.5 h-4 w-4" />
                <span className="hidden sm:inline">{t("documents.selectToDelete")}</span>
              </Button>
            )}

            {/* View toggle */}
            <div className="flex items-center gap-1 border-l border-border pl-2">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => onViewModeChange("grid")}
                aria-label={t("common.gridView")}
              >
                <Grid3x3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => onViewModeChange("list")}
                aria-label={t("common.listView")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
