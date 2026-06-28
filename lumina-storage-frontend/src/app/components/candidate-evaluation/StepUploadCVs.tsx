import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { Upload, Database, Loader2, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { documentsApi } from "@/app/api/endpoints/documents";
import { candidateEvaluationApi } from "@/app/api/endpoints/candidateEvaluation";
import { DocumentPicker } from "./DocumentPicker";
import { CandidateCard } from "./CandidateCard";
import type {
  ParsedJD,
  ParsedCandidate,
} from "@/app/types/candidateEvaluation";

interface StepUploadCVsProps {
  jd: ParsedJD;
  jdDocumentId: string;
  candidates: ParsedCandidate[];
  onParsed: (candidates: ParsedCandidate[]) => void;
}

const ACCEPTED = ".pdf,.doc,.docx,.txt";
const MAX_CVS = 50;
const PARALLEL = 3; // max concurrent LLM parse calls

interface Progress {
  phase: "uploading" | "scanning";
  current: number;
  total: number;
  currentFilename?: string;
}

/**
 * Process docIds in parallel with concurrency limit, calling onProgress after each completion.
 */
async function parseWithProgress(
  docIds: string[],
  filenames: Map<string, string>,
  jd: ParsedJD,
  jdDocumentId: string,
  onProgress: (completed: number, total: number, filename: string) => void
): Promise<{ candidates: ParsedCandidate[]; errors: string[] }> {
  const total = docIds.length;
  let completed = 0;
  const allCandidates: ParsedCandidate[] = [];
  const errors: string[] = [];

  // Create a queue of work
  const queue = [...docIds];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < queue.length) {
      const idx = nextIndex++;
      const docId = queue[idx];
      const filename = filenames.get(docId) || `CV ${idx + 1}`;
      try {
        const result = await candidateEvaluationApi.parseCVs(
          [docId],
          jd,
          jdDocumentId,
          []
        );
        // Re-index candidates
        for (const c of result.candidates) {
          c.index = allCandidates.length + errors.length;
          allCandidates.push(c);
        }
        if (result.errors?.length) {
          errors.push(...result.errors);
        }
      } catch (e) {
        errors.push(
          `${filename}: ${e instanceof Error ? e.message : "Lỗi không xác định"}`
        );
      }
      completed++;
      onProgress(completed, total, filename);
    }
  }

  // Launch PARALLEL workers
  const workers = Array.from({ length: Math.min(PARALLEL, total) }, () =>
    worker()
  );
  await Promise.all(workers);

  // Re-index all candidates sequentially
  allCandidates.forEach((c, i) => {
    c.index = i;
  });

  return { candidates: allCandidates, errors };
}

export function StepUploadCVs({
  jd,
  jdDocumentId,
  candidates,
  onParsed,
}: StepUploadCVsProps) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef(false);

  const existingCount = candidates.length;
  const remainingSlots = MAX_CVS - existingCount;

  const handleFiles = useCallback(
    (newFiles: FileList | File[]) => {
      setFiles((prev) => {
        const combined = [...prev, ...Array.from(newFiles)];
        if (combined.length > remainingSlots) {
          toast.warning(
            t("candidateEvaluation.cv.maxWarning", { max: MAX_CVS })
          );
          return combined.slice(0, remainingSlots);
        }
        return combined;
      });
    },
    [remainingSlots, t]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleParse = async () => {
    if (!files.length) return;
    abortRef.current = false;
    setLoading(true);

    try {
      // Phase 1: Upload all files
      setProgress({ phase: "uploading", current: 0, total: files.length });
      const formData = new FormData();
      files.forEach((f) => formData.append("files", f));
      formData.append("source_type", "chat_attachment");
      const docs = await documentsApi.upload(formData);

      if (abortRef.current) return;

      // Build docId → filename map
      const filenameMap = new Map<string, string>();
      docs.forEach((d, i) => {
        filenameMap.set(
          d.id,
          files[i]?.name || d.original_filename || `CV ${i + 1}`
        );
      });
      const docIds = docs.map((d) => d.id);

      // Filter out already-parsed
      const existingDocIds = new Set(candidates.map((c) => c.document_id));
      const newDocIds = docIds.filter((id) => !existingDocIds.has(id));

      if (!newDocIds.length) {
        toast.info(t("candidateEvaluation.cv.allParsed"));
        setFiles([]);
        setLoading(false);
        setProgress(null);
        return;
      }

      // Phase 2: Scan CVs with progress
      setProgress({ phase: "scanning", current: 0, total: newDocIds.length });

      const { candidates: newCandidates, errors } = await parseWithProgress(
        newDocIds,
        filenameMap,
        jd,
        jdDocumentId,
        (completed, total, filename) => {
          setProgress({
            phase: "scanning",
            current: completed,
            total,
            currentFilename: filename,
          });
        }
      );

      // Merge with existing
      const merged = [...candidates, ...newCandidates];
      merged.forEach((c, i) => {
        c.index = i;
      });
      onParsed(merged);
      setFiles([]);

      const successCount = newCandidates.filter((c) => !c.error).length;
      toast.success(t("candidateEvaluation.cv.parseSuccess", { success: successCount, total: newDocIds.length }));
      if (errors.length) {
        toast.warning(t("candidateEvaluation.cv.filesError", { count: errors.length }));
      }
    } catch {
      toast.error(t("candidateEvaluation.cv.parseError"));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const handleStorageSelect = async (documentIds: string[]) => {
    if (!documentIds.length) return;
    if (documentIds.length > remainingSlots) {
      toast.warning(t("candidateEvaluation.cv.maxWarning", { max: MAX_CVS }));
      documentIds = documentIds.slice(0, remainingSlots);
    }

    abortRef.current = false;
    setLoading(true);

    try {
      // Filter out already-parsed
      const existingDocIds = new Set(candidates.map((c) => c.document_id));
      const newDocIds = documentIds.filter((id) => !existingDocIds.has(id));

      if (!newDocIds.length) {
        toast.info(t("candidateEvaluation.cv.allParsed"));
        setLoading(false);
        return;
      }

      setProgress({ phase: "scanning", current: 0, total: newDocIds.length });

      const filenameMap = new Map<string, string>();
      newDocIds.forEach((id, i) => filenameMap.set(id, `CV ${i + 1}`));

      const { candidates: newCandidates, errors } = await parseWithProgress(
        newDocIds,
        filenameMap,
        jd,
        jdDocumentId,
        (completed, total, filename) => {
          setProgress({
            phase: "scanning",
            current: completed,
            total,
            currentFilename: filename,
          });
        }
      );

      const merged = [...candidates, ...newCandidates];
      merged.forEach((c, i) => {
        c.index = i;
      });
      onParsed(merged);

      const successCount = newCandidates.filter((c) => !c.error).length;
      toast.success(t("candidateEvaluation.cv.parseSuccess", { success: successCount, total: newDocIds.length }));
      if (errors.length) toast.warning(t("candidateEvaluation.cv.filesError", { count: errors.length }));
    } catch {
      toast.error(t("candidateEvaluation.cv.parseError"));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  // Progress bar percentage
  const progressPct = progress
    ? Math.round((progress.current / Math.max(progress.total, 1)) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-base text-gray-600">
          {t("candidateEvaluation.cv.uploadDescription")}
        </p>
        <span className="text-sm text-gray-400">
          {t("candidateEvaluation.cv.cvCount", { current: existingCount, max: MAX_CVS })}
        </span>
      </div>

      {/* Limit warning */}
      {remainingSlots <= 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-base text-amber-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {t("candidateEvaluation.cv.limitWarning", { max: MAX_CVS })}
        </div>
      )}

      {/* Drop zone */}
      {remainingSlots > 0 && (
        <div
          className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            dragOver
              ? "border-brand-300 bg-brand-50"
              : "border-gray-300 hover:border-gray-400"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <Upload className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          <p className="mb-2 text-base text-gray-600">
            {t("candidateEvaluation.cv.dragDropHint", { max: MAX_CVS })}
          </p>
          <div className="flex justify-center gap-2">
            <label className="cursor-pointer">
              <Button variant="outline" size="sm" asChild>
                <span>{t("candidateEvaluation.cv.selectFiles")}</span>
              </Button>
              <input
                type="file"
                className="hidden"
                accept={ACCEPTED}
                multiple
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPicker(true)}
            >
              <Database className="mr-1 h-4 w-4" />
              {t("candidateEvaluation.cv.fromStorage")}
            </Button>
          </div>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && !loading && (
        <div className="space-y-1">
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {files.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                className="flex items-center justify-between rounded border bg-gray-50 px-3 py-1.5 text-base"
              >
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="ml-2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <Button
            onClick={handleParse}
            disabled={loading}
            className="bg-brand-500 hover:bg-brand-600 mt-2 w-full text-white disabled:opacity-50"
          >
            {t("candidateEvaluation.cv.parseCVs", { count: files.length })}
          </Button>
        </div>
      )}

      {/* Progress bar */}
      {loading && progress && (
        <div className="space-y-2 rounded-lg border bg-gray-50 p-4">
          {/* Phase label */}
          <div className="flex items-center justify-between text-base">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
              <span className="font-medium text-gray-700">
                {progress.phase === "uploading"
                  ? t("candidateEvaluation.cv.uploading")
                  : t("candidateEvaluation.cv.scanning", { current: progress.current, total: progress.total })}
              </span>
            </div>
            <span className="text-brand-600 text-sm font-semibold">
              {progressPct}%
            </span>
          </div>

          {/* Bar */}
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="bg-brand-500 h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Current file name */}
          {progress.phase === "scanning" && progress.currentFilename && (
            <p className="truncate text-sm text-gray-500">
              {t("candidateEvaluation.cv.justCompleted", { filename: progress.currentFilename })}
            </p>
          )}
        </div>
      )}

      {/* Loading without progress (fallback) */}
      {loading && !progress && (
        <div className="flex items-center justify-center gap-2 py-4 text-base text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("candidateEvaluation.cv.parsing")}
        </div>
      )}

      {/* Parsed candidates */}
      {candidates.length > 0 && !loading && (
        <div>
          <h3 className="mb-2 text-base font-bold text-gray-900">
            {t("candidateEvaluation.cv.candidateList", { count: candidates.length, max: MAX_CVS })}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {candidates.map((c, i) => (
              <CandidateCard key={c.document_id} candidate={c} index={i} />
            ))}
          </div>
        </div>
      )}

      <DocumentPicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handleStorageSelect}
        multiple
        extensions={[".pdf", ".docx", ".doc", ".txt"]}
        title={t("candidateEvaluation.cv.pickTitleStorage")}
      />
    </div>
  );
}
