import { useEffect, useState } from "react";
import { Download, FileCheck, Loader2, Eye, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { axiosClient } from "@/app/api/client";

interface FileAttachmentCardProps {
  renderedDocumentId: string;
  previewPdfId?: string | null;
  appliedCount?: number;
}

export function FileAttachmentCard({
  renderedDocumentId,
  previewPdfId,
  appliedCount,
}: FileAttachmentCardProps) {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState(false);

  // Fetch PDF blob when preview toggled
  useEffect(() => {
    if (!showPreview || !previewPdfId || pdfUrl) return;
    let cancelled = false;
    setPdfError(false);
    (async () => {
      try {
        const res = await axiosClient.get<Blob>(
          `/documents/${previewPdfId}/download`,
          { responseType: "blob" }
        );
        if (!cancelled && res.data.size > 0) {
          setPdfUrl(URL.createObjectURL(res.data));
        } else if (!cancelled) {
          setPdfError(true);
        }
      } catch {
        if (!cancelled) setPdfError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showPreview, previewPdfId, pdfUrl]);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await axiosClient.get<Blob>(
        `/documents/${renderedDocumentId}/download`,
        { responseType: "blob" }
      );
      const cd = res.headers["content-disposition"] as string | undefined;
      let filename = "filled-document";
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
      /* ignore */
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="-mt-1 mr-4 ml-10">
      <div className="min-w-0">
        <div className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5">
          <FileCheck className="h-3.5 w-3.5 shrink-0 text-green-600" />
          <span className="text-[11px] font-medium text-green-800">
            {appliedCount
              ? t("chat.skillResult.filledShort", { count: appliedCount })
              : t("chat.skillResult.filledShortNoCount")}
          </span>
          {previewPdfId && (
            <button
              onClick={() => setShowPreview(true)}
              className="inline-flex items-center gap-0.5 text-[11px] text-green-600 hover:text-green-800"
            >
              <Eye className="h-3 w-3" />
              {t("chat.skillResult.preview")}
            </button>
          )}
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            {downloading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {t("common.download")}
          </button>
        </div>
      </div>

      {/* Fullscreen PDF Preview Modal */}
      {showPreview && previewPdfId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="relative flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <FileCheck className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-gray-800">
                  {appliedCount
                    ? t("chat.skillResult.previewTitleWithCount", { count: appliedCount })
                    : t("chat.skillResult.previewTitle")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
                >
                  {downloading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  {t("common.download")}
                </button>
                <button
                  onClick={() => setShowPreview(false)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            {/* Modal body */}
            <div className="flex-1 bg-gray-100">
              {pdfError ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-400">
                  {t("chat.skillResult.previewError")}
                </div>
              ) : pdfUrl ? (
                <iframe
                  src={pdfUrl}
                  className="h-full w-full"
                  title="Preview"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-green-500" />
                  <span className="ml-2 text-sm text-green-600">
                    {t("chat.skillResult.loadingPreview")}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
