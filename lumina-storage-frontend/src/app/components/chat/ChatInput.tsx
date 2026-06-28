import { useCallback, useEffect, useRef, useState } from "react";
import {
  Send,
  Square,
  ChevronDown,
  Star,
  Check,
  Paperclip,
  Upload,
  X,
  Bot,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";
import type { AIModelConfigResponse } from "@/app/types/aiModelConfig";

const SKILL_EXTENSIONS = new Set([
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".pdf",
  ".pptx",
  ".txt",
  ".csv",
]);

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

interface ChatInputProps {
  message: string;
  isStreaming: boolean;
  models: AIModelConfigResponse[];
  selectedModelId: string | null;
  onMessageChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onModelChange: (id: string) => void;
  onAttachSkillDocument?: (file: File) => void;
  attachedDocument?: File | null;
  onRemoveAttachment?: () => void;
}

export function ChatInput({
  message,
  isStreaming,
  models,
  selectedModelId,
  onMessageChange,
  onSend,
  onStop,
  onModelChange,
  onAttachSkillDocument,
  attachedDocument,
  onRemoveAttachment,
}: ChatInputProps) {
  const { t } = useTranslation();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragCounterRef = useRef(0);
  const isMobile =
    typeof window !== "undefined" && navigator.maxTouchPoints > 0;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [message]);

  const selectedModel =
    models.find((m) => m.id === selectedModelId) ??
    models.find((m) => m.is_default) ??
    null;

  const handleFileUpload = useCallback(
    (file: File) => {
      if (!onAttachSkillDocument) return;
      const ext = getFileExtension(file.name);
      if (!SKILL_EXTENSIONS.has(ext)) {
        toast.error(
          t("chat.fileTypeError", { formats: [...SKILL_EXTENSIONS].join(", ") })
        );
        return;
      }
      onAttachSkillDocument(file);
      toast.success(t("chat.fileAttached", { name: file.name }));
    },
    [onAttachSkillDocument, t]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
      e.target.value = "";
    },
    [handleFileUpload]
  );

  return (
    <div
      className="px-3 pb-3 pt-2 sm:px-4 sm:pb-4"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.doc,.xlsx,.xls"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Drag overlay */}
      {isDragging && (
        <div className="border-brand-400 bg-brand-50 mb-2 flex items-center justify-center rounded-xl border-2 border-dashed px-4 py-6">
          <Upload className="text-brand-500 mr-2 h-5 w-5" />
          <span className="text-brand-600 text-sm font-medium">
            {t("chat.dropFileHint")}
          </span>
        </div>
      )}

      {/* Attached file chip */}
      {attachedDocument && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5">
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-blue-700">
            {attachedDocument.name}
          </span>
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
            {t("chat.attachedBadge")}
          </span>
          {onRemoveAttachment && (
            <button onClick={onRemoveAttachment} className="text-blue-400 hover:text-blue-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Input card */}
      <div className="rounded-xl border bg-white shadow-sm">
        {/* Textarea row */}
        <div className="flex items-end gap-2 px-3 py-2">
          {onAttachSkillDocument && !attachedDocument && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              className="mb-0.5 shrink-0 text-gray-400 transition-colors hover:text-gray-600 disabled:opacity-40"
              title={t("chat.attachFile")}
            >
              <Upload className="h-4 w-4" />
            </button>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isStreaming && !isMobile) {
                e.preventDefault();
                onSend();
              }
            }}
            enterKeyHint={isMobile ? "send" : "enter"}
            disabled={isStreaming}
            placeholder={
              attachedDocument
                ? t("chat.placeholder")
                : t("chat.multiDocPlaceholder")
            }
            className="max-h-[160px] min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-sm text-gray-900 outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="mb-0.5 shrink-0 rounded-lg bg-destructive p-1.5 text-destructive-foreground transition-opacity hover:opacity-90"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!message.trim() && !attachedDocument}
              className="bg-brand-500 mb-0.5 shrink-0 rounded-lg p-1.5 text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Bottom toolbar — model picker */}
        <div className="flex items-center gap-3 border-t px-3 py-1.5">
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <Bot className="h-3 w-3" />
                <span className="max-w-[160px] truncate">
                  {selectedModel?.name ?? "..."}
                </span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </PopoverTrigger>

            {models.length > 0 && (
              <PopoverContent align="start" side="top" className="w-[280px] p-0">
                <div className="border-b px-3 py-2">
                  <p className="text-xs font-semibold">AI Model</p>
                </div>
                <div className="max-h-[240px] overflow-y-auto py-1">
                  {models.map((model) => {
                    const isActive = selectedModelId === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          onModelChange(model.id);
                          setPopoverOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted/50 ${isActive ? "bg-muted/50" : ""}`}
                      >
                        <span className="shrink-0 rounded border px-1 py-0.5 text-[9px] font-normal capitalize text-muted-foreground">
                          {model.provider}
                        </span>
                        <span className="flex-1 truncate text-left">
                          {model.name}
                          {model.is_default && (
                            <Star className="ml-1 inline h-3 w-3 fill-yellow-400 text-yellow-400" />
                          )}
                        </span>
                        {isActive && (
                          <Check className="text-brand-500 h-3.5 w-3.5 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            )}
          </Popover>
        </div>
      </div>
    </div>
  );
}
