import { useEffect, useState } from "react";
import {
  Download,
  FileCheck,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { axiosClient } from "@/app/api/client";

interface SkillResultBannerProps {
  renderedDocumentId: string;
  previewPdfId?: string | null;
  onDismiss?: () => void;
}

export function SkillResultBanner({
  renderedDocumentId,
  previewPdfId,
  onDismiss,
}: SkillResultBannerProps) {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // Fetch PDF blob URL when preview is toggled on
  useEffect(() => {
    if (!showPreview || !previewPdfId || pdfUrl) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await axiosClient.get<Blob>(
          `/documents/${previewPdfId}/download`,
          { responseType: "blob" }
        );
        if (!cancelled) {
          const url = URL.createObjectURL(res.data);
          setPdfUrl(url);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showPreview, previewPdfId, pdfUrl]);

  // Cleanup blob URL on unmount
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
      const contentDisposition = res.headers["content-disposition"] as
        | string
        | undefined;
      let filename = "filled-document";
      if (contentDisposition) {
        const utf8Match = contentDisposition.match(
          /filename\*=UTF-8''([^;]+)/i
        );
        if (utf8Match) {
          filename = decodeURIComponent(utf8Match[1]);
        } else {
          const match = contentDisposition.match(/filename="?([^"]+)"?/);
          if (match) filename = match[1];
        }
      }
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mx-4 mb-3 rounded-xl border border-green-200 bg-green-50">
      <div className="flex items-center gap-3 px-4 py-3">
        <FileCheck className="h-5 w-5 flex-shrink-0 text-green-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-green-800">
            {t("chat.skillResult.filledTitle")}
          </p>
          <p className="text-xs text-green-600">
            {t("chat.skillResult.filledSubtitle")}
          </p>
        </div>

        {previewPdfId && (
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-800"
          >
            {showPreview ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" /> {t("chat.skillResult.hidePreview")}
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" /> {t("chat.skillResult.preview")}
              </>
            )}
          </button>
        )}

        <button
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-60"
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {t("common.download")}
        </button>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-xs text-green-500 hover:text-green-700"
          >
            {t("chat.skillResult.dismiss")}
          </button>
        )}
      </div>

      {showPreview && previewPdfId && (
        <div className="border-t border-green-200">
          {pdfUrl ? (
            <iframe
              src={pdfUrl}
              className="h-[500px] w-full"
              title="Document preview"
            />
          ) : (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-green-500" />
              <span className="ml-2 text-sm text-green-600">
                {t("chat.skillResult.loadingPreview")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
