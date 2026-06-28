import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { Loader2, Download, Eye, EyeOff, FileText, X } from "lucide-react";
import { toast } from "sonner";
import { axiosClient } from "@/app/api/client";
import { candidateEvaluationApi } from "@/app/api/endpoints/candidateEvaluation";
import { useSimulatedProgress } from "@/app/hooks/useSimulatedProgress";
import type {
  ParsedJD,
  ParsedCandidate,
  CandidateRanking,
  InterviewQuestion,
} from "@/app/types/candidateEvaluation";

interface StepReportProps {
  jd: ParsedJD;
  jdDocumentId: string;
  candidates: ParsedCandidate[];
  rankings: CandidateRanking[];
  interviewQuestions: Record<string, InterviewQuestion[]>;
  topN: number;
  reportDocumentId: string | null;
  reportPreviewId: string | null;
  onGenerated: (documentId: string, previewId: string) => void;
}

export function StepReport({
  jd,
  jdDocumentId,
  candidates,
  rankings,
  interviewQuestions,
  topN,
  reportDocumentId,
  reportPreviewId,
  onGenerated,
}: StepReportProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(false);

  const reportMessages = useMemo(
    () => [
      t("candidateEvaluation.report.reportMsg0"),
      t("candidateEvaluation.report.reportMsg1"),
      t("candidateEvaluation.report.reportMsg2"),
      t("candidateEvaluation.report.reportMsg3"),
      t("candidateEvaluation.report.reportMsg4"),
      t("candidateEvaluation.report.reportMsg5"),
    ],
    [t]
  );

  const { message: progressMessage, percent: simPct } = useSimulatedProgress({
    active: loading,
    messages: reportMessages,
    messageIntervalMs: 4500,
    stepPercent: 1,
  });

  // Fetch PDF as blob (authenticated) when preview toggled
  useEffect(() => {
    if (!showPreview || !reportPreviewId || pdfBlobUrl) return;
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(false);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    (async () => {
      try {
        const res = await axiosClient.get<Blob>(
          `/documents/${reportPreviewId}/download`,
          { responseType: "blob", signal: controller.signal }
        );
        if (!cancelled && res.data.size > 0) {
          setPdfBlobUrl(URL.createObjectURL(res.data));
        } else if (!cancelled) {
          setPdfError(true);
        }
      } catch {
        if (!cancelled) setPdfError(true);
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setPdfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [showPreview, reportPreviewId, pdfBlobUrl]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await candidateEvaluationApi.generateReport(
        jd,
        candidates,
        rankings,
        interviewQuestions,
        jdDocumentId,
        topN
      );
      onGenerated(result.rendered_document_id, result.preview_pdf_id);
      // Reset preview state for new report
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
      setPdfError(false);
      toast.success(t("candidateEvaluation.report.generateSuccess"));
    } catch {
      toast.error(t("candidateEvaluation.report.generateError"));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!reportDocumentId) return;
    try {
      const res = await axiosClient.get<Blob>(
        `/documents/${reportDocumentId}/download`,
        { responseType: "blob" }
      );
      const cd = res.headers["content-disposition"] as string | undefined;
      let filename = "candidate_evaluation.pdf";
      if (cd) {
        const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
        if (m) filename = decodeURIComponent(m[1]);
        else {
          const m2 = cd.match(/filename="?([^"]+)"?/);
          if (m2) filename = m2[1];
        }
      }
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("candidateEvaluation.report.downloadError"));
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-lg border bg-gray-50 p-4">
        <h3 className="mb-2 font-semibold text-gray-900">{t("candidateEvaluation.report.summary")}</h3>
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-md border bg-white p-3 text-center">
            <p className="text-3xl font-bold text-gray-900">
              {candidates.filter((c) => !c.error).length}
            </p>
            <p className="text-sm text-gray-500">{t("candidateEvaluation.report.candidates")}</p>
          </div>
          <div className="rounded-md border bg-white p-3 text-center">
            <p className="text-3xl font-bold text-emerald-600">
              {rankings.length}
            </p>
            <p className="text-sm text-gray-500">{t("candidateEvaluation.report.ranked")}</p>
          </div>
          <div className="rounded-md border bg-white p-3 text-center">
            <p className="text-brand-600 text-3xl font-bold">
              {Object.keys(interviewQuestions).length}
            </p>
            <p className="text-sm text-gray-500">{t("candidateEvaluation.report.withQuestions")}</p>
          </div>
        </div>
      </div>

      {!reportDocumentId ? (
        <div className="space-y-3">
          {!loading && (
            <Button
              onClick={handleGenerate}
              size="lg"
              className="bg-brand-500 hover:bg-brand-600 w-full text-white"
            >
              <FileText className="mr-2 h-4 w-4" />
              {t("candidateEvaluation.report.generatePDF")}
            </Button>
          )}

          {loading && (
            <div className="space-y-2 rounded-lg border bg-gray-50 p-4">
              <div className="flex items-center justify-between text-base">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                  <span className="font-medium text-gray-700">
                    {progressMessage}
                  </span>
                </div>
                <span className="text-brand-600 text-sm font-semibold">
                  {Math.round(simPct)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="bg-brand-500 h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${simPct}%` }}
                />
              </div>
              <p className="text-sm text-gray-400">
                {t("candidateEvaluation.report.renderingNote")}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button onClick={handleDownload} className="flex-1">
              <Download className="mr-2 h-4 w-4" />
              {t("candidateEvaluation.report.downloadPDF")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? (
                <>
                  <EyeOff className="mr-2 h-4 w-4" />
                  {t("candidateEvaluation.report.hide")}
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-4 w-4" />
                  {t("candidateEvaluation.report.show")}
                </>
              )}
            </Button>
          </div>

          {showPreview && (
            <div className="overflow-hidden rounded-lg border bg-gray-100">
              {pdfLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                  <span className="ml-2 text-base text-gray-500">
                    {t("candidateEvaluation.report.loadingPreview")}
                  </span>
                </div>
              ) : pdfError ? (
                <div className="flex flex-col items-center justify-center py-20 text-base text-gray-400">
                  <X className="mb-2 h-6 w-6" />
                  <p>{t("candidateEvaluation.report.previewError")}</p>
                  <p>{t("candidateEvaluation.report.previewErrorHint")}</p>
                </div>
              ) : pdfBlobUrl ? (
                <iframe
                  src={pdfBlobUrl}
                  className="h-[600px] w-full"
                  title="PDF Preview"
                />
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
