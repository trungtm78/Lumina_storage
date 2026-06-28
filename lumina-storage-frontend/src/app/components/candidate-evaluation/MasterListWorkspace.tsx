import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/app/components/ui/button";
import {
  Upload,
  Database,
  Loader2,
  X,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Download,
  ChevronLeft,
  FileSpreadsheet,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { documentsApi } from "@/app/api/endpoints/documents";
import { candidateEvaluationApi } from "@/app/api/endpoints/candidateEvaluation";
import { DocumentPicker } from "./DocumentPicker";
import type {
  ParsedJD,
  ParsedCandidate,
  ColumnMappingItem,
  ImportLogEntry,
  ScanToMasterListResponse,
  ExtractedField,
} from "@/app/types/candidateEvaluation";
import {
  ALL_EXTRACTED_FIELDS,
  EXTRACTED_FIELD_LABELS,
} from "@/app/types/candidateEvaluation";
import { cn } from "@/app/components/ui/utils";

const ACCEPTED_CV = ".pdf,.doc,.docx,.txt";
const ACCEPTED_EXCEL = ".xlsx,.xls";
const MAX_CVS = 50;
const PARALLEL = 3;

interface Progress {
  phase: "uploading" | "scanning";
  current: number;
  total: number;
  currentFilename?: string;
}

// ── Phase 1 helpers ──────────────────────────────────────────────────────────

async function parseCVsWithProgress(
  docIds: string[],
  filenames: Map<string, string>,
  onProgress: (completed: number, total: number, filename: string) => void,
  t: TFunction
): Promise<{ candidates: ParsedCandidate[]; errors: string[] }> {
  const total = docIds.length;
  let completed = 0;
  const allCandidates: ParsedCandidate[] = [];
  const errors: string[] = [];
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
          {} as ParsedJD,
          "",
          []
        );
        for (const c of result.candidates) {
          c.index = allCandidates.length;
          allCandidates.push(c);
        }
        if (result.errors?.length) errors.push(...result.errors);
      } catch (e) {
        errors.push(
          `${filename}: ${e instanceof Error ? e.message : t("candidateEvaluation.masterList.unknownError")}`
        );
      }
      completed++;
      onProgress(completed, total, filename);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, total) }, () => worker())
  );
  allCandidates.forEach((c, i) => {
    c.index = i;
  });
  return { candidates: allCandidates, errors };
}

// ── Sub-components ───────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: ImportLogEntry["status"];
}

function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation();
  if (status === "success") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        {t("candidateEvaluation.masterList.successBadge")}
      </span>
    );
  }
  if (status === "needs_review") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        <AlertTriangle className="h-3 w-3" />
        {t("candidateEvaluation.masterList.needsReviewBadge")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
      <X className="h-3 w-3" />
      {t("candidateEvaluation.masterList.failedBadge")}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface MasterListWorkspaceProps {
  phase: Phase;
  onPhaseChange: (phase: Phase) => void;
}

type Phase = 1 | 2 | 3;

export function MasterListWorkspace({ phase, onPhaseChange: setPhase }: MasterListWorkspaceProps) {
  const { t } = useTranslation();

  // Phase 1 state
  const [cvFiles, setCvFiles] = useState<File[]>([]);
  const [candidates, setCandidates] = useState<ParsedCandidate[]>([]);
  const [cvLoading, setCvLoading] = useState(false);
  const [cvProgress, setCvProgress] = useState<Progress | null>(null);
  const [showCvPicker, setShowCvPicker] = useState(false);
  const [cvDragOver, setCvDragOver] = useState(false);

  // Phase 2 state
  const [masterListFile, setMasterListFile] = useState<File | null>(null);
  const [masterListDocId, setMasterListDocId] = useState<string | null>(null);
  const [excelColumns, setExcelColumns] = useState<string[]>([]);
  const [excelLoading, setExcelLoading] = useState(false);
  const [showExcelPicker, setShowExcelPicker] = useState(false);
  // checkedFields: which fields the user wants to include
  const [checkedFields, setCheckedFields] = useState<Set<ExtractedField>>(
    () =>
      new Set([
        "name",
        "email",
        "phone",
        "current_role",
        "current_company",
        "experience_years",
      ] as ExtractedField[])
  );
  // columnNames: custom target column name per field (empty string = use default label)
  const [columnNames, setColumnNames] = useState<
    Partial<Record<ExtractedField, string>>
  >({});

  // Phase 3 state
  const [importResult, setImportResult] =
    useState<ScanToMasterListResponse | null>(null);
  const [importLoading, setImportLoading] = useState(false);

  // ── Phase 1: CV upload + parse ─────────────────────────────────────────────

  const handleCvFiles = useCallback((newFiles: FileList | File[]) => {
    setCvFiles((prev) => {
      const combined = [...prev, ...Array.from(newFiles)];
      if (combined.length > MAX_CVS) {
        toast.warning(t("candidateEvaluation.masterList.maxCVsWarning", { max: MAX_CVS }));
        return combined.slice(0, MAX_CVS);
      }
      return combined;
    });
  }, []);

  const handleCvDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setCvDragOver(false);
      if (e.dataTransfer.files.length) handleCvFiles(e.dataTransfer.files);
    },
    [handleCvFiles]
  );

  const handleParseCVs = async () => {
    if (!cvFiles.length) return;
    setCvLoading(true);
    setCvProgress({ phase: "uploading", current: 0, total: cvFiles.length });

    try {
      const formData = new FormData();
      cvFiles.forEach((f) => formData.append("files", f));
      formData.append("source_type", "chat_attachment");
      const docs = await documentsApi.upload(formData);

      const filenameMap = new Map<string, string>();
      docs.forEach((d, i) =>
        filenameMap.set(
          d.id,
          cvFiles[i]?.name || d.original_filename || `CV ${i + 1}`
        )
      );
      const docIds = docs.map((d) => d.id);

      setCvProgress({ phase: "scanning", current: 0, total: docIds.length });

      const { candidates: parsed, errors } = await parseCVsWithProgress(
        docIds,
        filenameMap,
        (completed, total, filename) => {
          setCvProgress({
            phase: "scanning",
            current: completed,
            total,
            currentFilename: filename,
          });
        },
        t
      );

      setCandidates(parsed);
      setCvFiles([]);

      const ok = parsed.filter((c) => !c.error).length;
      toast.success(t("candidateEvaluation.masterList.parseCVsSuccess", { success: ok, total: docIds.length }));
      if (errors.length) toast.warning(t("candidateEvaluation.masterList.parseCVsWarning", { count: errors.length }));
    } catch {
      toast.error(t("candidateEvaluation.masterList.parseCVsError"));
    } finally {
      setCvLoading(false);
      setCvProgress(null);
    }
  };

  const handleStorageCVSelect = async (documentIds: string[]) => {
    if (!documentIds.length) return;
    setCvLoading(true);
    setCvProgress({ phase: "scanning", current: 0, total: documentIds.length });

    try {
      const filenameMap = new Map<string, string>();
      documentIds.forEach((id, i) => filenameMap.set(id, `CV ${i + 1}`));

      const { candidates: parsed, errors } = await parseCVsWithProgress(
        documentIds,
        filenameMap,
        (completed, total, filename) => {
          setCvProgress({
            phase: "scanning",
            current: completed,
            total,
            currentFilename: filename,
          });
        },
        t
      );

      setCandidates(parsed);
      const ok = parsed.filter((c) => !c.error).length;
      toast.success(t("candidateEvaluation.masterList.parseCVsSuccess", { success: ok, total: documentIds.length }));
      if (errors.length) toast.warning(t("candidateEvaluation.masterList.parseCVsWarning", { count: errors.length }));
    } catch {
      toast.error(t("candidateEvaluation.masterList.parseCVsError"));
    } finally {
      setCvLoading(false);
      setCvProgress(null);
    }
  };

  const cvProgressPct = cvProgress
    ? Math.round((cvProgress.current / Math.max(cvProgress.total, 1)) * 100)
    : 0;
  const validCandidates = candidates.filter((c) => !c.error);

  // ── Phase 2: Master List setup + column mapping ────────────────────────────

  // Resolved name: custom override → fallback to Vietnamese label
  const resolvedName = (field: ExtractedField): string =>
    columnNames[field]?.trim() || EXTRACTED_FIELD_LABELS[field];

  const loadExcelHeaders = async (docId: string) => {
    setExcelLoading(true);
    try {
      const res = await candidateEvaluationApi.readMasterListHeaders(docId);
      setExcelColumns(res.columns);
      // Auto-fill column names where there's an obvious match in existing Excel headers
      setColumnNames((prev) => {
        const next = { ...prev };
        for (const field of ALL_EXTRACTED_FIELDS) {
          if (next[field] !== undefined) continue; // don't overwrite user edits
          const label = EXTRACTED_FIELD_LABELS[field].toLowerCase();
          const match = res.columns.find((col) =>
            col.toLowerCase().includes(label.split(" ")[0])
          );
          if (match) next[field] = match;
        }
        return next;
      });
    } catch {
      toast.error(t("candidateEvaluation.masterList.loadExcelError"));
    } finally {
      setExcelLoading(false);
    }
  };

  const handleExcelFile = async (file: File) => {
    setMasterListFile(file);
    setExcelLoading(true);
    try {
      const formData = new FormData();
      formData.append("files", file);
      formData.append("source_type", "chat_attachment");
      const docs = await documentsApi.upload(formData);
      const docId = docs[0].id;
      setMasterListDocId(docId);
      await loadExcelHeaders(docId);
    } catch {
      toast.error(t("candidateEvaluation.masterList.uploadExcelError"));
      setExcelLoading(false);
    }
  };

  const handleStorageExcelSelect = async (documentIds: string[]) => {
    if (!documentIds.length) return;
    setMasterListDocId(documentIds[0]);
    setMasterListFile(null);
    await loadExcelHeaders(documentIds[0]);
  };

  const toggleField = (field: ExtractedField) => {
    setCheckedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (checkedFields.size === ALL_EXTRACTED_FIELDS.length) {
      setCheckedFields(new Set());
    } else {
      setCheckedFields(new Set(ALL_EXTRACTED_FIELDS));
    }
  };

  const activeMappings: ColumnMappingItem[] = ALL_EXTRACTED_FIELDS.filter((f) =>
    checkedFields.has(f)
  ).map((f) => ({ extracted_field: f, target_column: resolvedName(f) }));

  // ── Phase 3: Import ────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!activeMappings.length) {
      toast.error(t("candidateEvaluation.masterList.minColumnError"));
      return;
    }
    setImportLoading(true);
    try {
      const docIds = [
        ...new Set(
          candidates.filter((c) => !c.error).map((c) => c.document_id)
        ),
      ];
      const result = await candidateEvaluationApi.scanToMasterList(
        docIds,
        activeMappings,
        masterListDocId ?? undefined
      );
      setImportResult(result);
      toast.success(
        t("candidateEvaluation.masterList.importSuccess", { success: result.success_count, review: result.needs_review_count, failed: result.failed_count })
      );
    } catch {
      toast.error(t("candidateEvaluation.masterList.importError"));
    } finally {
      setImportLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!importResult?.output_document_id) return;
    try {
      await documentsApi.download(
        importResult.output_document_id,
        "master_list_import.xlsx"
      );
    } catch {
      toast.error(t("candidateEvaluation.masterList.downloadError"));
    }
  };

  const handleDownloadLog = () => {
    if (!importResult) return;
    const header = `${t("candidateEvaluation.masterList.importCandidate")},Document ID,${t("candidateEvaluation.masterList.importStatus")},${t("candidateEvaluation.masterList.importRow")},${t("candidateEvaluation.masterList.importNote")}\n`;
    const rows = importResult.import_log.map((e) =>
      [
        `"${e.candidate_name}"`,
        e.document_id,
        e.status,
        e.row_number ?? "",
        `"${e.message ?? ""}"`,
      ].join(",")
    );
    const csv = header + rows.join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import_log.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* ── Phase 1 ── */}
      {phase === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {t("candidateEvaluation.masterList.phase1Description", { max: MAX_CVS })}
          </p>

          {/* Drop zone */}
          <div
            className={cn(
              "rounded-lg border-2 border-dashed p-8 text-center transition-colors",
              cvDragOver
                ? "border-brand-300 bg-brand-50"
                : "border-gray-300 hover:border-gray-400"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setCvDragOver(true);
            }}
            onDragLeave={() => setCvDragOver(false)}
            onDrop={handleCvDrop}
          >
            <Upload className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            <p className="mb-3 text-sm text-gray-600">{t("candidateEvaluation.masterList.dragDropHint")}</p>
            <div className="flex justify-center gap-2">
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" asChild>
                  <span>{t("candidateEvaluation.masterList.selectFiles")}</span>
                </Button>
                <input
                  type="file"
                  className="hidden"
                  accept={ACCEPTED_CV}
                  multiple
                  onChange={(e) =>
                    e.target.files && handleCvFiles(e.target.files)
                  }
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCvPicker(true)}
              >
                <Database className="mr-1 h-4 w-4" />
                {t("candidateEvaluation.masterList.fromStorage")}
              </Button>
            </div>
          </div>

          {/* File list */}
          {cvFiles.length > 0 && !cvLoading && (
            <div className="space-y-1">
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {cvFiles.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between rounded border bg-gray-50 px-3 py-1.5 text-sm"
                  >
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setCvFiles((p) => p.filter((_, j) => j !== i))
                      }
                      className="ml-2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                onClick={handleParseCVs}
                className="bg-brand-500 hover:bg-brand-600 mt-2 w-full text-white disabled:opacity-50"
              >
                {t("candidateEvaluation.masterList.parseCVs", { count: cvFiles.length })}
              </Button>
            </div>
          )}

          {/* Progress */}
          {cvLoading && cvProgress && (
            <div className="space-y-2 rounded-lg border bg-gray-50 p-4">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                  <span className="font-medium text-gray-700">
                    {cvProgress.phase === "uploading"
                      ? t("candidateEvaluation.masterList.uploading")
                      : t("candidateEvaluation.masterList.scanningProgress", { current: cvProgress.current, total: cvProgress.total })}
                  </span>
                </div>
                <span className="text-brand-600 font-semibold">
                  {cvProgressPct}%
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="bg-brand-500 h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${cvProgressPct}%` }}
                />
              </div>
              {cvProgress.phase === "scanning" &&
                cvProgress.currentFilename && (
                  <p className="truncate text-xs text-gray-500">
                    {t("candidateEvaluation.masterList.justCompleted", { filename: cvProgress.currentFilename })}
                  </p>
                )}
            </div>
          )}

          {/* Candidate summary */}
          {candidates.length > 0 && !cvLoading && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {t("candidateEvaluation.masterList.successCount", { success: validCandidates.length })}
                {candidates.length - validCandidates.length > 0 && (
                  <span className="text-amber-600">
                    {t("candidateEvaluation.masterList.errorCount", { count: candidates.length - validCandidates.length })}
                  </span>
                )}
              </div>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {candidates.map((c) => (
                  <div
                    key={c.document_id}
                    className="flex items-center gap-2 text-xs text-gray-600"
                  >
                    {c.error ? (
                      <AlertCircle className="h-3 w-3 shrink-0 text-red-400" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                    )}
                    <span className="truncate">
                      {c.error
                        ? c.original_filename
                        : `${c.name || c.original_filename} — ${c.current_role || "?"}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => setPhase(2)}
              disabled={validCandidates.length === 0}
              className="bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
            >
              {t("candidateEvaluation.masterList.nextConfigColumns")}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Phase 2 ── */}
      {phase === 2 && (
        <div className="space-y-5">
          {/* Master List file upload */}
          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              {t("candidateEvaluation.masterList.masterListDescription")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" asChild>
                  <span>
                    <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                    {masterListFile
                      ? masterListFile.name
                      : t("candidateEvaluation.masterList.uploadExcel")}
                  </span>
                </Button>
                <input
                  type="file"
                  className="hidden"
                  accept={ACCEPTED_EXCEL}
                  onChange={(e) =>
                    e.target.files?.[0] && handleExcelFile(e.target.files[0])
                  }
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowExcelPicker(true)}
              >
                <Database className="mr-1.5 h-4 w-4" />
                {t("candidateEvaluation.masterList.fromStorageLabel")}
              </Button>
              {masterListDocId && (
                <button
                  type="button"
                  onClick={() => {
                    setMasterListDocId(null);
                    setMasterListFile(null);
                    setExcelColumns([]);
                  }}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500"
                >
                  <X className="h-3.5 w-3.5" /> {t("candidateEvaluation.masterList.removeFile")}
                </button>
              )}
              {excelLoading && (
                <span className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("candidateEvaluation.masterList.readingColumns")}
                </span>
              )}
              {excelColumns.length > 0 && !excelLoading && (
                <span className="text-xs text-emerald-600">
                  {t("candidateEvaluation.masterList.columnsRead", { count: excelColumns.length })}
                </span>
              )}
            </div>
          </div>

          {/* Column checklist */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">
                {t("candidateEvaluation.masterList.selectColumns")}
              </h3>
              <button
                type="button"
                onClick={toggleAll}
                className="text-brand-600 text-xs hover:underline"
              >
                {checkedFields.size === ALL_EXTRACTED_FIELDS.length
                  ? t("candidateEvaluation.masterList.deselectAll")
                  : t("candidateEvaluation.masterList.selectAll")}
              </button>
            </div>

            {/* datalist for Excel column suggestions */}
            {excelColumns.length > 0 && (
              <datalist id="excel-cols">
                {excelColumns.map((col) => (
                  <option key={col} value={col} />
                ))}
              </datalist>
            )}

            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                  <tr>
                    <th className="w-8 px-3 py-2" />
                    <th className="px-3 py-2 text-left">{t("candidateEvaluation.masterList.extractedData")}</th>
                    <th className="px-3 py-2 text-left">
                      {t("candidateEvaluation.masterList.excelColumn")}
                      <span className="ml-1 font-normal text-gray-400 normal-case">
                        {t("candidateEvaluation.masterList.emptyDefaultHint")}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ALL_EXTRACTED_FIELDS.map((field) => {
                    const checked = checkedFields.has(field);
                    const defaultLabel = EXTRACTED_FIELD_LABELS[field];
                    return (
                      <tr
                        key={field}
                        onClick={() => toggleField(field)}
                        className={cn(
                          "cursor-pointer transition-colors",
                          checked
                            ? "bg-brand-50 hover:bg-brand-100"
                            : "hover:bg-gray-50"
                        )}
                      >
                        {/* Checkbox */}
                        <td
                          className="px-3 py-2.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleField(field)}
                            className="accent-brand-600 h-4 w-4 cursor-pointer rounded border-gray-300"
                          />
                        </td>

                        {/* Field label */}
                        <td
                          className={cn(
                            "px-3 py-2.5 font-medium",
                            checked ? "text-gray-900" : "text-gray-400"
                          )}
                        >
                          {defaultLabel}
                        </td>

                        {/* Column name input — only active when checked */}
                        <td
                          className="px-3 py-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {checked ? (
                            <input
                              type="text"
                              list={
                                excelColumns.length > 0
                                  ? "excel-cols"
                                  : undefined
                              }
                              value={columnNames[field] ?? ""}
                              onChange={(e) =>
                                setColumnNames((prev) => ({
                                  ...prev,
                                  [field]: e.target.value,
                                }))
                              }
                              placeholder={defaultLabel}
                              className="focus:border-brand-400 focus:ring-brand-400 w-full rounded border border-gray-200 bg-white px-2 py-1 text-sm placeholder-gray-400 focus:ring-1 focus:outline-none"
                            />
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-1.5 text-xs text-gray-400">
              {t("candidateEvaluation.masterList.columnsSelected", { selected: checkedFields.size, total: ALL_EXTRACTED_FIELDS.length })}
              {checkedFields.size === 0 && (
                <span className="text-amber-600">
                  {t("candidateEvaluation.masterList.minOneColumn")}
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setPhase(1)}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              {t("candidateEvaluation.masterList.backButton")}
            </Button>
            <Button
              onClick={() => setPhase(3)}
              disabled={checkedFields.size === 0}
              className="bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
            >
              {t("candidateEvaluation.masterList.previewImport")}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Phase 3 ── */}
      {phase === 3 && (
        <div className="space-y-5">
          {/* Preview table */}
          {!importResult && (
            <>
              <div>
                <h3 className="mb-1 text-sm font-semibold text-gray-800">
                  {t("candidateEvaluation.masterList.previewTitle")}
                </h3>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        {activeMappings.map((m) => (
                          <th
                            key={m.extracted_field}
                            className="px-3 py-2 text-left font-medium whitespace-nowrap"
                          >
                            {m.target_column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {validCandidates.slice(0, 5).map((c) => (
                        <tr key={c.document_id} className="hover:bg-gray-50">
                          {activeMappings.map((m) => {
                            const val =
                              c[m.extracted_field as keyof ParsedCandidate];
                            const display = Array.isArray(val)
                              ? (val as string[]).slice(0, 3).join(", ")
                              : String(val ?? "");
                            return (
                              <td
                                key={m.extracted_field}
                                className="max-w-[160px] truncate px-3 py-2 text-gray-700"
                              >
                                {display}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  {t("candidateEvaluation.masterList.previewSummary", {
                    count: validCandidates.length,
                    destination: masterListDocId
                      ? t("candidateEvaluation.masterList.existingFile")
                      : t("candidateEvaluation.masterList.newFile"),
                  })}
                </p>
              </div>

              <div className="flex items-center justify-between">
                <Button variant="outline" onClick={() => setPhase(2)}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  {t("candidateEvaluation.masterList.backButton")}
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={importLoading}
                  className="bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
                >
                  {importLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("candidateEvaluation.masterList.writing")}
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                      {t("candidateEvaluation.masterList.writeButton")}
                    </>
                  )}
                </Button>
              </div>
            </>
          )}

          {/* Import result */}
          {importResult && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-700">
                    {importResult.success_count}
                  </p>
                  <p className="text-xs text-emerald-600">{t("candidateEvaluation.masterList.successCount2")}</p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
                  <p className="text-2xl font-bold text-amber-700">
                    {importResult.needs_review_count}
                  </p>
                  <p className="text-xs text-amber-600">{t("candidateEvaluation.masterList.needsReviewCount")}</p>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
                  <p className="text-2xl font-bold text-red-700">
                    {importResult.failed_count}
                  </p>
                  <p className="text-xs text-red-600">{t("candidateEvaluation.masterList.failedCount")}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  onClick={handleDownload}
                  className="bg-brand-500 hover:bg-brand-600 text-white"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {t("candidateEvaluation.masterList.downloadExcel")}
                </Button>
                <Button variant="outline" onClick={handleDownloadLog}>
                  <Download className="mr-2 h-4 w-4" />
                  {t("candidateEvaluation.masterList.downloadLog")}
                </Button>
              </div>

              {/* Log table */}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-800">
                  {t("candidateEvaluation.masterList.importDetailTitle")}
                </h3>
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                      <tr>
                        <th className="px-3 py-2 text-left">{t("candidateEvaluation.masterList.importCandidate")}</th>
                        <th className="px-3 py-2 text-left">{t("candidateEvaluation.masterList.importRow")}</th>
                        <th className="px-3 py-2 text-left">{t("candidateEvaluation.masterList.importStatus")}</th>
                        <th className="px-3 py-2 text-left">{t("candidateEvaluation.masterList.importNote")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {importResult.import_log.map((entry, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="max-w-[180px] truncate px-3 py-2 text-gray-800">
                            {entry.candidate_name}
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            {entry.row_number ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge status={entry.status} />
                          </td>
                          <td className="max-w-[200px] truncate px-3 py-2 text-xs text-gray-500">
                            {entry.message ?? ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={() => {
                  setCandidates([]);
                  setMasterListDocId(null);
                  setMasterListFile(null);
                  setExcelColumns([]);
                  setColumnNames({});
                  setImportResult(null);
                  setPhase(1);
                }}
              >
                {t("candidateEvaluation.masterList.newImport")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Pickers */}
      <DocumentPicker
        open={showCvPicker}
        onClose={() => setShowCvPicker(false)}
        onSelect={handleStorageCVSelect}
        multiple
        extensions={[".pdf", ".docx", ".doc", ".txt"]}
        title={t("candidateEvaluation.masterList.pickCVTitle")}
      />
      <DocumentPicker
        open={showExcelPicker}
        onClose={() => setShowExcelPicker(false)}
        onSelect={handleStorageExcelSelect}
        multiple={false}
        extensions={[".xlsx", ".xls"]}
        title={t("candidateEvaluation.masterList.pickExcelTitle")}
      />
    </div>
  );
}
