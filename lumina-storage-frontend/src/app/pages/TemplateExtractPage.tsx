import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  FileText,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { axiosClient } from "@/app/api/client";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import {
  templatesApi,
  type DraftField,
  type DraftStatusResponse,
} from "@/app/api/endpoints/templates";
import { cn } from "@/app/components/ui/utils";

const POLL_INTERVAL_MS = 3000;

export function TemplateExtractPage() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [fields, setFields] = useState<DraftField[]>([]);
  const [docDescription, setDocDescription] = useState<string>("");
  const [initialized, setInitialized] = useState(false);
  const triggerRef = useRef<boolean>(false);

  // Poll draft status every 3s while pending/running
  const draftQuery = useQuery<DraftStatusResponse>({
    queryKey: ["template-draft", docId],
    queryFn: () => templatesApi.getDraft(docId!),
    enabled: !!docId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return POLL_INTERVAL_MS;
      if (data.status === "pending" || data.status === "running") {
        return POLL_INTERVAL_MS;
      }
      return false;
    },
  });

  // Auto-trigger extract-draft if status is "none"
  useEffect(() => {
    if (!docId || triggerRef.current) return;
    if (draftQuery.data && draftQuery.data.status === "none") {
      triggerRef.current = true;
      templatesApi
        .extractDraft(docId)
        .then(() => {
          queryClient.invalidateQueries({
            queryKey: ["template-draft", docId],
          });
        })
        .catch((err) => {
          toast.error(
            t("templateExtract.startError", {
              error:
                err?.response?.data?.detail ??
                err?.message ??
                t("templateExtract.unknownError"),
            })
          );
        });
    }
  }, [docId, draftQuery.data, queryClient, t]);

  // Populate local state from draft once when success arrives
  useEffect(() => {
    if (initialized) return;
    const data = draftQuery.data;
    if (data?.status === "success" && data.draft) {
      setFields(data.draft.fields);
      setDocDescription(data.draft.doc_description ?? "");
      setInitialized(true);
    }
  }, [draftQuery.data, initialized]);

  const commitMutation = useMutation({
    mutationFn: () =>
      templatesApi.commit(docId!, {
        fields,
        doc_description: docDescription || undefined,
      }),
    onSuccess: (tmpl) => {
      toast.success(t("templateExtract.savedSuccess", { title: tmpl.title }));
      navigate(`/generator`);
    },
    onError: (err: unknown) => {
      const error = err as {
        response?: { data?: { detail?: string } };
        message?: string;
      };
      toast.error(
        t("templateExtract.saveError", {
          error:
            error?.response?.data?.detail ??
            error?.message ??
            t("templateExtract.unknownError"),
        })
      );
    },
  });

  const updateField = (idx: number, patch: Partial<DraftField>) => {
    setFields((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, ...patch } : f))
    );
  };

  const deleteField = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleCommit = () => {
    if (fields.length === 0) {
      toast.error(t("templateExtract.minFields"));
      return;
    }
    // Validate uniqueness + non-empty
    const seen = new Set<string>();
    for (const f of fields) {
      if (!f.name.trim()) {
        toast.error(t("templateExtract.emptyPlaceholder"));
        return;
      }
      if (seen.has(f.name)) {
        toast.error(
          t("templateExtract.duplicatePlaceholder", { name: f.name })
        );
        return;
      }
      seen.add(f.name);
    }
    commitMutation.mutate();
  };

  const status = draftQuery.data?.status;
  const isLoadingDraft =
    draftQuery.isLoading ||
    status === "pending" ||
    status === "running" ||
    status === "none";
  const hasError = status === "failure";

  return (
    <div className="flex h-dvh flex-col bg-gray-50">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </button>
          <div className="h-4 w-px bg-gray-200" />
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="text-brand-500 h-4 w-4" />
              <h1 className="text-sm font-semibold text-gray-900">
                {t("templateExtract.title")}
              </h1>
            </div>
            <p className="text-xs text-gray-500">
              {t("templateExtract.analyzeDesc")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            {fields.length > 0 &&
              `${fields.length} ${t("templateExtract.fieldUnit")}`}
          </span>
          <button
            onClick={handleCommit}
            disabled={
              !initialized || commitMutation.isPending || fields.length === 0
            }
            className={cn(
              "bg-brand-500 hover:bg-brand-600 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors",
              "disabled:cursor-not-allowed disabled:bg-gray-300"
            )}
          >
            {commitMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t("templateExtract.saveTemplate")}
          </button>
        </div>
      </div>

      {/* Body: split-screen */}
      <div className="flex min-h-0 flex-1">
        {/* Left: DOCX preview */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-gray-200 bg-white">
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2">
            <FileText className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs font-medium text-gray-500">
              {t("templateExtract.originalDoc")}
            </span>
          </div>
          {docId && <SourceDocxPreview docId={docId} />}
        </div>

        {/* Right: field editor */}
        <div className="flex w-[480px] shrink-0 flex-col bg-gray-50">
          <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
            <span className="text-xs font-medium text-gray-500">
              {t("templateExtract.fieldList")}
            </span>
            {status === "success" && (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <Check className="h-3 w-3" />
                {t("templateExtract.analyzeSuccess")}
              </span>
            )}
          </div>

          {/* Doc description field at top */}
          <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
            <label className="mb-1 block text-xs font-medium text-gray-700">
              {t("templateExtract.docDescription")}
            </label>
            <textarea
              value={docDescription}
              onChange={(e) => setDocDescription(e.target.value)}
              rows={2}
              placeholder={t("templateExtract.docDescPlaceholder")}
              className="focus:border-brand-400 w-full resize-y rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-800 outline-none"
            />
          </div>

          {/* Loading / error / fields */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {isLoadingDraft && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Loader2 className="text-brand-500 h-8 w-8 animate-spin" />
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    {t("templateExtract.analyzing")}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {t("templateExtract.analyzingDesc")}
                  </p>
                </div>
              </div>
            )}

            {hasError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-700">
                  {t("templateExtract.analysisFailed")}
                </p>
                <p className="mt-1 text-xs text-red-600">
                  {draftQuery.data?.error ?? t("templateExtract.unknownError")}
                </p>
                <button
                  onClick={() => {
                    triggerRef.current = false;
                    queryClient.invalidateQueries({
                      queryKey: ["template-draft", docId],
                    });
                  }}
                  className="mt-2 rounded border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                >
                  {t("templateExtract.retry")}
                </button>
              </div>
            )}

            {!isLoadingDraft &&
              !hasError &&
              initialized &&
              fields.length === 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  {t("templateExtract.noFields")}
                </div>
              )}

            <div className="flex flex-col gap-3">
              {fields.map((f, idx) => (
                <FieldCard
                  key={f.id}
                  field={f}
                  onChange={(patch) => updateField(idx, patch)}
                  onDelete={() => deleteField(idx)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── FieldCard ────────────────────────────────────────────────────────

function FieldCard({
  field,
  onChange,
  onDelete,
}: {
  field: DraftField;
  onChange: (patch: Partial<DraftField>) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <input
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder={t("templateExtract.labelPlaceholder")}
            className="focus:border-brand-400 w-full rounded border border-transparent bg-gray-50 px-2 py-1 text-sm font-medium text-gray-900 outline-none hover:border-gray-200 focus:bg-white"
          />
          <div className="mt-1 flex items-center gap-2 px-2">
            <span className="font-mono text-[10px] text-gray-400">
              {`{${field.name}}`}
            </span>
            <span className="text-[10px] text-gray-300">·</span>
            <select
              value={field.type}
              onChange={(e) => onChange({ type: e.target.value })}
              className="rounded bg-transparent text-[10px] text-gray-500 outline-none focus:bg-white"
            >
              <option value="blank">blank</option>
              <option value="date">date</option>
              <option value="label_empty">label_empty</option>
              <option value="empty">empty</option>
              <option value="placeholder">placeholder</option>
            </select>
            <span className="text-[10px] text-gray-300">·</span>
            <span className="font-mono text-[10px] text-gray-400">
              @{field.location}
            </span>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
          title={t("templateExtract.deleteField")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <textarea
        value={field.description}
        onChange={(e) => onChange({ description: e.target.value })}
        rows={3}
        placeholder={t("templateExtract.fieldDescPlaceholder")}
        className="focus:border-brand-400 w-full resize-y rounded border border-gray-200 px-2 py-1.5 text-[11px] leading-snug text-gray-700 outline-none"
      />

      <div className="mt-1.5 flex items-center gap-2">
        <label className="text-[10px] text-gray-500">
          {t("templateExtract.replacedString")}
        </label>
        <input
          value={field.current}
          onChange={(e) => onChange({ current: e.target.value })}
          placeholder={t("templateExtract.replacedStringPlaceholder")}
          className="focus:border-brand-400 flex-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-[10px] text-gray-700 outline-none focus:bg-white"
        />
      </div>
    </div>
  );
}

// ─── SourceDocxPreview ─────────────────────────────────────────────────

function SourceDocxPreview({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);

    (async () => {
      try {
        const resp = await axiosClient.get<Blob>(
          API_ENDPOINTS.documents.download(docId),
          { responseType: "blob" }
        );
        const buf = await resp.data.arrayBuffer();
        const mammoth = (await import("mammoth")).default;
        const { value } = await mammoth.convertToHtml(
          { arrayBuffer: buf },
          {
            styleMap: ["p[style-name='Table Contents'] => td p"],
          }
        );
        if (!cancelled) {
          setHtml(value);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const e = err as { message?: string };
          setError(e?.message ?? t("templateExtract.noFile"));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [docId, t]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-gray-100">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      )}
      {error && (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
          <X className="mr-1 h-4 w-4" />
          {error}
        </div>
      )}
      {html && (
        <div className="mx-auto w-full max-w-[860px] px-4 py-6">
          <div
            className="docx-html-preview rounded bg-white p-10 shadow-sm"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )}
    </div>
  );
}
