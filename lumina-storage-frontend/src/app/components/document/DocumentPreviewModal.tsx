import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import {
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileSpreadsheet,
  File,
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
} from "lucide-react";
import { Document as DocType } from "../../types/document";
import { documentsApi } from "../../api/endpoints/documents";
import { axiosClient } from "../../api/client";
import { API_ENDPOINTS } from "../../api/endpoints";
import {
  formatFileSize,
  getFileTypeFromExtension,
} from "../../utils/formatters";
import { toast } from "sonner";

import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

/* ───────── helpers ───────── */

const PREVIEWABLE_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "office",
  "application/vnd.ms-excel": "office",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "office",
  "application/msword": "office",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "office",
  "application/vnd.ms-powerpoint": "office",
};

function canPreview(mime: string, ext: string): boolean {
  if (mime.startsWith("image/")) return true;
  if (mime.startsWith("text/")) return true;
  if (PREVIEWABLE_MIME[mime]) return true;
  const e = ext.toLowerCase().replace(/^\./, "");
  return ["pdf", "xlsx", "xls", "csv", "docx", "doc", "pptx", "ppt"].includes(e);
}

function resolvePreviewKind(
  mime: string,
  ext: string
): "pdf" | "image" | "office" | "text" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/") || ext.toLowerCase().replace(/^\./, "") === "csv")
    return "text";
  if (PREVIEWABLE_MIME[mime] === "office") return "office";
  const e = ext.toLowerCase().replace(/^\./, "");
  if (["xlsx", "xls", "docx", "doc", "pptx", "ppt"].includes(e)) return "office";
  if (e === "pdf") return "pdf";
  return null;
}

const clampZoom = (z: number) => Math.min(5, Math.max(0.25, z));

/* ───────── main modal ───────── */

interface DocumentPreviewModalProps {
  document: DocType | null;
  documents: DocType[];
  open: boolean;
  onClose: () => void;
  initialPage?: number | null;
}

export function DocumentPreviewModal({
  document: doc,
  documents,
  open,
  onClose,
  initialPage,
}: DocumentPreviewModalProps) {
  const { t } = useTranslation();
  const [zoomScale, setZoomScale] = useState(1);
  const zoomScaleRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeDoc, setActiveDoc] = useState<DocType | null>(null);
  const [activePage, setActivePage] = useState<number | null | undefined>(
    initialPage
  );

  // Keep ref in sync so pinch handler always has latest value
  useEffect(() => {
    zoomScaleRef.current = zoomScale;
  }, [zoomScale]);

  // Pinch-to-zoom on mobile (two-finger gesture)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let startDist = 0;
    let startScale = 1;
    let pinching = false;

    const getDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinching = true;
        startDist = getDist(e.touches);
        startScale = zoomScaleRef.current;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault(); // prevent browser page-zoom during pinch
      setZoomScale(clampZoom(startScale * (getDist(e.touches) / startDist)));
    };

    const onTouchEnd = () => {
      pinching = false;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []); // runs once — uses ref for current zoom

  useEffect(() => {
    if (doc) {
      setActiveDoc(doc);
      setActivePage(initialPage);
      setZoomScale(1);
    }
  }, [doc, initialPage]);

  const activeIndex = useMemo(
    () => (activeDoc ? documents.findIndex((d) => d.id === activeDoc.id) : -1),
    [activeDoc, documents]
  );

  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex >= 0 && activeIndex < documents.length - 1;

  const navigate = useCallback(
    (direction: "prev" | "next") => {
      const newIdx = direction === "prev" ? activeIndex - 1 : activeIndex + 1;
      if (newIdx >= 0 && newIdx < documents.length) {
        setActiveDoc(documents[newIdx]);
        setZoomScale(1);
        setActivePage(null);
      }
    },
    [activeIndex, documents]
  );

  const handleDownload = useCallback(async () => {
    if (!activeDoc) return;
    try {
      await documentsApi.download(
        activeDoc.id,
        activeDoc.original_filename || activeDoc.title
      );
    } catch {
      toast.error(t("documents.downloadError"));
    }
  }, [activeDoc]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") navigate("prev");
      if (e.key === "ArrowRight") navigate("next");
      if (e.key === "+" || e.key === "=")
        setZoomScale((z) => clampZoom(z + 0.25));
      if (e.key === "-") setZoomScale((z) => clampZoom(z - 0.25));
    },
    [onClose, navigate]
  );

  if (!open || !activeDoc) return null;

  const fileType = getFileTypeFromExtension(activeDoc.extension);
  const showPreview = canPreview(activeDoc.mime_type, activeDoc.extension);

  return createPortal(
    <div
      className="fixed inset-0 z-[999] flex flex-col bg-gray-900/95"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      autoFocus
    >
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-700/50 bg-gray-900/80 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <FileIcon fileType={fileType} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-white">
              {activeDoc.title || activeDoc.original_filename}
            </h2>
            <p className="text-xs text-gray-400">
              {activeDoc.extension?.toUpperCase().replace(".", "")} •{" "}
              {formatFileSize(activeDoc.file_size)}
            </p>
          </div>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1 rounded-lg bg-gray-800 px-2 py-1">
          <button
            onClick={() => setZoomScale((z) => clampZoom(z - 0.25))}
            className="rounded p-1.5 text-gray-400 transition-colors hover:text-white"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs text-gray-300">
            {Math.round(zoomScale * 100)}%
          </span>
          <button
            onClick={() => setZoomScale((z) => clampZoom(z + 0.25))}
            className="rounded p-1.5 text-gray-400 transition-colors hover:text-white"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={() => setZoomScale(1)}
            className="rounded p-1.5 text-gray-400 transition-colors hover:text-white"
            title="Reset zoom"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{t("common.download")}</span>
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Content — scroll normally; pinch or +/- to zoom */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {hasPrev && (
          <button
            onClick={() => navigate("prev")}
            className="absolute top-1/2 left-4 z-10 -translate-y-1/2 rounded-full bg-gray-800/80 p-2 text-white transition-colors hover:bg-gray-700"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {/* Scrollable viewport — zoom via CSS `zoom` so layout scales too */}
        <div ref={scrollRef} className="h-full w-full overflow-auto">
          <div
            className="flex flex-col items-start p-4"
            style={{ zoom: zoomScale }}
          >
            {showPreview ? (
              <PreviewContent
                docId={activeDoc.id}
                mimeType={activeDoc.mime_type}
                extension={activeDoc.extension}
                title={activeDoc.title || activeDoc.original_filename}
                initialPage={activePage ?? undefined}
              />
            ) : (
              <NoPreview
                fileType={fileType}
                extension={activeDoc.extension}
                onDownload={handleDownload}
              />
            )}
          </div>
        </div>

        {hasNext && (
          <button
            onClick={() => navigate("next")}
            className="absolute top-1/2 right-4 z-10 -translate-y-1/2 rounded-full bg-gray-800/80 p-2 text-white transition-colors hover:bg-gray-700"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Bottom bar */}
      {documents.length > 1 && (
        <div className="flex shrink-0 items-center justify-center border-t border-gray-700/50 bg-gray-900/80 py-2">
          <span className="text-xs text-gray-400">
            {activeIndex + 1} / {documents.length}
          </span>
        </div>
      )}
    </div>,
    globalThis.document.body
  );
}

/* ───────── preview content router ───────── */

function PreviewContent({
  docId,
  mimeType,
  extension,
  title,
  initialPage,
}: {
  docId: string;
  mimeType: string;
  extension: string;
  title: string;
  initialPage?: number;
}) {
  const { t } = useTranslation();
  const [_blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const kind = resolvePreviewKind(mimeType, extension);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setBlob(null);
    setBlobUrl(null);
    setTextContent(null);

    const isText = kind === "text";
    // Office formats (DOCX, XLSX, PPTX, etc.): convert to PDF via Gotenberg for accurate rendering
    const endpoint =
      kind === "office"
        ? API_ENDPOINTS.documents.previewPdf(docId)
        : API_ENDPOINTS.documents.preview(docId);

    axiosClient
      .get(endpoint, { responseType: isText ? "text" : "blob" })
      .then((res) => {
        if (cancelled) return;
        if (isText) {
          setTextContent(res.data as string);
        } else {
          const b = res.data as Blob;
          setBlob(b);
          setBlobUrl(URL.createObjectURL(b));
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, mimeType, kind]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-gray-400" />
          <p className="text-sm text-gray-400">{t("documents.loadingPreview")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center">
        <p className="text-sm text-gray-400">{t("documents.previewLoadError")}</p>
      </div>
    );
  }

  switch (kind) {
    case "pdf":
    case "office": // converted to PDF via Gotenberg (/preview-pdf)
      return blobUrl ? (
        <PdfPreview blobUrl={blobUrl} title={title} initialPage={initialPage} />
      ) : null;
    case "image":
      return blobUrl ? <ImagePreview blobUrl={blobUrl} title={title} /> : null;
    case "text":
      return textContent !== null ? (
        <TextPreview content={textContent} />
      ) : null;
    default:
      return null;
  }
}

/* ───────── PDF preview ───────── */

function PdfPreview({
  blobUrl,
  title,
  initialPage,
}: {
  blobUrl: string;
  title: string;
  initialPage?: number;
}) {
  const { t } = useTranslation();
  const [numPages, setNumPages] = useState(0);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pageWidth = Math.min(900, window.innerWidth - 32);

  const handleLoadSuccess = ({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    if (initialPage && initialPage > 1) {
      setTimeout(() => {
        pageRefs.current[initialPage - 1]?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 200);
    }
  };

  return (
    <div className="mx-auto flex flex-col items-center">
      <Document
        file={blobUrl}
        onLoadSuccess={handleLoadSuccess}
        loading={
          <div className="text-center">
            <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-gray-400" />
            <p className="text-sm text-gray-400">{t("documents.loadingPdf")}</p>
          </div>
        }
        error={
          <div className="text-center">
            <p className="text-sm text-gray-400">{t("documents.pdfLoadError")}</p>
          </div>
        }
      >
        {Array.from({ length: numPages }, (_, i) => (
          <div
            key={i}
            className="mb-4"
            ref={(el) => {
              pageRefs.current[i] = el;
            }}
          >
            <Page
              pageNumber={i + 1}
              width={pageWidth}
              renderAnnotationLayer
              renderTextLayer
              className="shadow-2xl"
              loading={
                <div
                  className="flex items-center justify-center bg-white"
                  style={{
                    width: pageWidth,
                    height: Math.round(pageWidth * 1.414),
                  }}
                >
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              }
            />
          </div>
        ))}
      </Document>
      {numPages > 0 && (
        <p className="mb-4 text-xs text-gray-500">
          {title} — {t("documents.pageCount", { count: numPages })}
        </p>
      )}
    </div>
  );
}

/* ───────── image preview ───────── */

function ImagePreview({ blobUrl, title }: { blobUrl: string; title: string }) {
  return (
    <img
      src={blobUrl}
      alt={title}
      className="mx-auto block max-w-full rounded-lg object-contain shadow-2xl"
      style={{ maxWidth: Math.min(900, window.innerWidth - 32) }}
    />
  );
}


/* ───────── text preview ───────── */

function TextPreview({ content }: { content: string }) {
  return (
    <div
      className="rounded-lg bg-white p-6 shadow-2xl"
      style={{ width: Math.min(900, window.innerWidth - 32) }}
    >
      <pre className="font-mono text-sm whitespace-pre-wrap text-gray-800">
        {content}
      </pre>
    </div>
  );
}

/* ───────── no preview fallback ───────── */

function NoPreview({
  fileType,
  extension,
  onDownload,
}: {
  fileType: string;
  extension: string;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-2xl bg-gray-800">
        <FileIcon fileType={fileType} size="lg" />
      </div>
      <h3 className="mb-2 text-lg font-medium text-white">
        {t("documents.cannotPreviewFile", {
          ext: extension?.toUpperCase().replace(".", ""),
        })}
      </h3>
      <p className="mb-6 text-sm text-gray-400">{t("documents.downloadToView")}</p>
      <button
        onClick={onDownload}
        className="bg-brand-500 hover:bg-brand-600 inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-white transition-colors"
      >
        <Download className="h-4 w-4" />
        {t("common.download")}
      </button>
    </div>
  );
}

/* ───────── file icon ───────── */

function FileIcon({
  fileType,
  size = "sm",
}: {
  fileType: string;
  size?: "sm" | "lg";
}) {
  const cls = size === "lg" ? "h-12 w-12" : "h-5 w-5";
  switch (fileType) {
    case "pdf":
      return <FileText className={`${cls} text-brand-400`} />;
    case "image":
      return <ImageIcon className={`${cls} text-blue-400`} />;
    case "xls":
      return <FileSpreadsheet className={`${cls} text-green-400`} />;
    case "doc":
      return <FileText className={`${cls} text-blue-400`} />;
    default:
      return <File className={`${cls} text-gray-400`} />;
  }
}
