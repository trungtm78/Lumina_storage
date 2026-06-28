import { useState, useMemo, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Search, Upload, Cloud, Share2, Clock, FileText, Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { documentsApi } from "@/app/api/endpoints/documents";
import { cn } from "@/app/components/ui/utils";

type PickerTab = "recent" | "mine" | "shared" | "upload";

export interface PickedFile {
  id: string;
  name: string;
  date?: string;
  reviewed?: boolean;
}

interface FilePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  multi?: boolean;
  excludeIds?: string[];
  onConfirm: (files: PickedFile[]) => void;
}

export function FilePicker({
  open,
  onOpenChange,
  title,
  multi = false,
  excludeIds = [],
  onConfirm,
}: FilePickerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<PickerTab>("mine");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setPicked(new Set());
      setQ("");
      setTab("mine");
    }
  }, [open]);

  // Fetch mine + recent
  const { data: mineData, isLoading: mineLoading } = useQuery({
    queryKey: ["file-picker-mine"],
    queryFn: () =>
      documentsApi.list({ page: 1, page_size: 60, sort_by: "updated_at", sort_order: "desc" }),
    enabled: open && (tab === "mine" || tab === "recent"),
    staleTime: 30_000,
  });

  // Fetch shared
  const { data: sharedData, isLoading: sharedLoading } = useQuery({
    queryKey: ["file-picker-shared"],
    queryFn: () =>
      documentsApi.list({ page: 1, page_size: 60, shared_with_me: true }),
    enabled: open && tab === "shared",
    staleTime: 30_000,
  });

  const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".doc", ".xlsx", ".xls"];
  const MAX_FILE_SIZE_MB = 25;

  const validateAndFilter = (files: File[]): File[] => {
    const valid: File[] = [];
    for (const f of files) {
      const ext = "." + (f.name.split(".").pop()?.toLowerCase() ?? "");
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        toast.error(t("review.filePicker.unsupportedType", { name: f.name }));
        continue;
      }
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        toast.error(t("review.filePicker.fileTooLarge", { name: f.name, max: MAX_FILE_SIZE_MB }));
        continue;
      }
      valid.push(f);
    }
    return valid;
  };

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      return documentsApi.upload(form);
    },
    onSuccess: (docs) => {
      queryClient.invalidateQueries({ queryKey: ["file-picker-mine"] });
      queryClient.invalidateQueries({ queryKey: ["review-documents"] });
      const picked: PickedFile[] = docs.map((d) => ({
        id: d.id,
        name: d.original_filename ?? d.title ?? d.id,
        date: (d as { updated_at?: string }).updated_at?.slice(0, 10),
      }));
      onConfirm(picked);
      onOpenChange(false);
      toast.success(t("review.filePicker.uploadSuccess", { count: docs.length }));
    },
    onError: () => toast.error(t("review.filePicker.uploadFailed")),
  });

  const ALLOWED_EXTS_UPPER = ["PDF", "DOCX", "DOC", "XLSX", "XLS"];

  // Normalize document list for the active tab
  const rawItems = useMemo(() => {
    const source = tab === "shared" ? sharedData : mineData;
    return (source?.items ?? []).map((d) => {
      const name = d.original_filename ?? d.title ?? d.id;
      const ext = name.split(".").pop()?.toUpperCase() ?? "DOC";
      const sizeBytes = (d as { file_size?: number }).file_size ?? 0;
      const size = sizeBytes
        ? sizeBytes >= 1_048_576
          ? `${(sizeBytes / 1_048_576).toFixed(1)} MB`
          : `${Math.round(sizeBytes / 1024)} KB`
        : null;
      const tooLarge = sizeBytes > MAX_FILE_SIZE_MB * 1024 * 1024;
      return {
        id: d.id,
        name,
        ext,
        size,
        sizeBytes,
        tooLarge,
        date: (d as { updated_at?: string; created_at?: string }).updated_at?.slice(0, 10),
      };
    });
  }, [tab, mineData, sharedData]);

  const displayItems = useMemo(() => {
    const base =
      tab === "recent" ? rawItems.slice(0, 15) : rawItems;
    const filtered = base.filter(
      (f) => !excludeIds.includes(f.id) && ALLOWED_EXTS_UPPER.includes(f.ext)
    );
    return q.trim()
      ? filtered.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()))
      : filtered;
  }, [tab, rawItems, excludeIds, q]);

  const isLoading = tab === "shared" ? sharedLoading : mineLoading;

  const toggle = (id: string) => {
    const item = displayItems.find((f) => f.id === id);
    if (item?.tooLarge) {
      toast.error(t("review.filePicker.fileTooLarge", { name: item.name, max: MAX_FILE_SIZE_MB }));
      return;
    }
    setPicked((prev) => {
      const next = new Set(prev);
      if (multi) {
        next.has(id) ? next.delete(id) : next.add(id);
      } else {
        next.clear();
        if (!prev.has(id)) next.add(id); // click lại file đang chọn → deselect
      }
      return next;
    });
  };

  const confirm = () => {
    const list = displayItems.filter((f) => picked.has(f.id));
    if (list.length === 0) return;
    onConfirm(list.map((f) => ({ id: f.id, name: f.name, date: f.date })));
    onOpenChange(false);
  };

  // Màu icon theo loại file — khớp design reference
  const fileIconColor = (ext: string) => {
    if (ext === "PDF") return "text-red-600 bg-red-50";
    if (ext === "XLSX" || ext === "XLS") return "text-emerald-600 bg-emerald-50";
    return "text-blue-600 bg-blue-50";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        max-w-3xl + sm:max-w-3xl: override default sm:max-w-lg từ DialogContent
        rounded-lg: giữ rounding nhỏ vừa, overflow-hidden clip nội dung theo border-radius
      */}
      <DialogContent className="max-w-3xl sm:max-w-3xl p-0 gap-0 overflow-hidden rounded-lg flex flex-col max-h-[85vh]">

        {/* Header — px-6 pt-5 pb-3, title text-base font-semibold */}
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border">
          <DialogTitle className="text-base font-semibold leading-normal">
            {title}
          </DialogTitle>
        </DialogHeader>

        {/* Search + Tabs */}
        <div className="px-6 py-3 border-b border-border space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 h-9"
              placeholder={t("review.filePicker.searchPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {/*
            TabsList h-9: height 36px
            rounded-md: override default rounded-xl, khớp design
          */}
          <Tabs value={tab} onValueChange={(v) => setTab(v as PickerTab)}>
            <TabsList className="h-9 rounded-md">
              <TabsTrigger value="recent" className="text-xs gap-1.5 rounded-sm">
                <Clock className="w-3.5 h-3.5" />{t("review.filePicker.tabRecent")}
              </TabsTrigger>
              <TabsTrigger value="mine" className="text-xs gap-1.5 rounded-sm">
                <Cloud className="w-3.5 h-3.5" />{t("review.filePicker.tabMine")}
              </TabsTrigger>
              <TabsTrigger value="shared" className="text-xs gap-1.5 rounded-sm">
                <Share2 className="w-3.5 h-3.5" />{t("review.filePicker.tabShared")}
              </TabsTrigger>
              <TabsTrigger value="upload" className="text-xs gap-1.5 rounded-sm">
                <Upload className="w-3.5 h-3.5" />{t("review.filePicker.tabUpload")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* File list — h-[380px] fixed height */}
        <ScrollArea className="h-[380px]">
          {tab === "upload" ? (
            /* Upload zone — kéo & thả hoạt động */
            <div
              className={cn(
                "flex flex-col items-center justify-center text-center py-16 px-8 transition-colors",
                dragOver
                  ? "bg-primary/5 border-2 border-dashed border-primary/50"
                  : "border-2 border-dashed border-transparent"
              )}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const valid = validateAndFilter(Array.from(e.dataTransfer.files));
                if (valid.length) uploadMutation.mutate(valid);
              }}
            >
              <div className={cn(
                "w-14 h-14 rounded-full flex items-center justify-center mb-3",
                dragOver ? "bg-primary/10" : "bg-muted"
              )}>
                <Upload className={cn("w-6 h-6", dragOver ? "text-primary" : "text-muted-foreground")} />
              </div>
              <p className="text-sm font-medium text-foreground">{t("review.filePicker.dragDrop")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("review.filePicker.supportedFormats")}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const valid = validateAndFilter(Array.from(e.target.files ?? []));
                  if (valid.length) uploadMutation.mutate(valid);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                disabled={uploadMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadMutation.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("review.filePicker.uploading")}</>
                ) : (
                  t("review.filePicker.selectFromComputer")
                )}
              </Button>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> {t("review.filePicker.loading")}
            </div>
          ) : displayItems.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              {t("review.filePicker.noFiles")}
            </div>
          ) : (
            /* px-3 py-2 — file list container */
            <div className="px-3 py-2">
              {displayItems.map((f) => {
                const sel = picked.has(f.id);
                const disabled = f.tooLarge;
                return (
                  <button
                    key={f.id}
                    onClick={() => toggle(f.id)}
                    disabled={false}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors",
                      disabled
                        ? "opacity-50 cursor-not-allowed"
                        : sel
                          ? "bg-primary/8 ring-1 ring-primary/30"
                          : "hover:bg-muted/60"
                    )}
                  >
                    {/* Checkbox */}
                    <div
                      className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0",
                        disabled
                          ? "border-border bg-muted"
                          : sel
                            ? "bg-primary border-primary"
                            : "border-border bg-card"
                      )}
                    >
                      {sel && !disabled && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>

                    {/* FileKindIcon */}
                    <div
                      className={cn(
                        "rounded-md flex items-center justify-center w-8 h-8 flex-shrink-0",
                        disabled ? "text-muted-foreground bg-muted" : fileIconColor(f.ext)
                      )}
                    >
                      <FileText className="w-4 h-4" />
                    </div>

                    {/* File info */}
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-medium truncate", disabled ? "text-muted-foreground" : "text-foreground")}>{f.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {f.ext}{f.size ? ` · ${f.size}` : ""}
                        {disabled && (
                          <span className="ml-1.5 text-amber-600">— {t("review.filePicker.tooLargeHint", { max: MAX_FILE_SIZE_MB })}</span>
                        )}
                      </p>
                    </div>

                    {/* Date */}
                    {f.date && !disabled && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {f.date}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/*
          Footer: px-6 py-3, border-t border-border bg-muted/30
          Override DialogFooter default (flex-col-reverse sm:flex-row sm:justify-end)
          bằng inner div với flex items-center justify-between w-full
        */}
        <DialogFooter className="px-6 py-3 border-t border-border bg-muted/30 flex-row items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {t("review.filePicker.filesSelected", { count: picked.size })}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t("review.filePicker.cancel")}
            </Button>
            <Button size="sm" disabled={picked.size === 0} onClick={confirm}>
              {t("review.filePicker.confirm")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
