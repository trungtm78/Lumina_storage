import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  FileText,
  File,
  FileSpreadsheet,
  Image as ImageIcon,
  MoreVertical,
  Loader2,
  Star,
  AlertCircle,
} from "lucide-react";
import { Document } from "../../types/document";
import { getFileTypeFromExtension } from "../../utils/formatters";
import { axiosClient } from "../../api/client";
import { API_ENDPOINTS } from "../../api/endpoints";

interface DocumentCardProps {
  document: Document;
  onClick?: (document: Document) => void;
  onMenuClick?: (document: Document) => void;
  selectMode?: boolean; // New prop to indicate if we're in select mode
  handleToggleStar?: (
    document: Document,
    event: React.MouseEvent<HTMLButtonElement>
  ) => void; // New prop for star toggle handler
}

/** In-memory cache: docId → blob URL */
const thumbCache = new Map<string, string>();

/**
 * Fetch thumbnail blob for a document card.
 * Priority: image_thumbnail path > /preview endpoint (images only)
 */
function useThumbnailBlob(doc: Document) {
  const cacheKey = doc.id;
  const isImage = doc.mime_type.startsWith("image/");
  const hasThumbPath = !!doc.image_thumbnail;
  const canFetch = hasThumbPath || isImage;

  const [blobUrl, setBlobUrl] = useState<string | null>(
    () => thumbCache.get(cacheKey) ?? null
  );

  useEffect(() => {
    if (!canFetch || thumbCache.has(cacheKey)) return;

    let cancelled = false;

    const url = hasThumbPath
      ? API_ENDPOINTS.documents.thumbnail(doc.id)
      : API_ENDPOINTS.documents.preview(doc.id);

    axiosClient
      .get(url, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        const blob = URL.createObjectURL(res.data as Blob);
        thumbCache.set(cacheKey, blob);
        setBlobUrl(blob);
      })
      .catch(() => {
        // fail silently — icon fallback
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, canFetch, hasThumbPath, doc.image_thumbnail, doc.id]);

  return blobUrl;
}

export function DocumentCard({
  document,
  onClick,
  onMenuClick,
  selectMode,
  handleToggleStar,
}: DocumentCardProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const thumbnailUrl = useThumbnailBlob(document);

  const getFileIcon = (type: string) => {
    switch (type) {
      case "pdf":
        return FileText;
      case "image":
        return ImageIcon;
      case "xls":
        return FileSpreadsheet;
      default:
        return File;
    }
  };

  const getIconColor = (type: string) => {
    switch (type) {
      case "pdf":
        return "text-brand-500";
      case "image":
        return "text-blue-500";
      case "xls":
        return "text-green-500";
      default:
        return "text-gray-500";
    }
  };

  const fileType = getFileTypeFromExtension(document.extension);
  const Icon = getFileIcon(fileType);
  const iconColor = getIconColor(fileType);

  return (
    <div
      className="group cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white transition-all hover:shadow-md"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onClick?.(document)}
    >
      {/* HEADER (icon + title + menu) */}
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={`h-4 w-4 ${iconColor} shrink-0`} />
          <p className="truncate text-sm text-gray-900">
            {document.title || document.original_filename}
          </p>
        </div>

        {!selectMode && handleToggleStar && (
          <button
            onClick={(e) => handleToggleStar(document, e)}
            className={`rounded p-0.5 opacity-100 transition-opacity group-hover/card:opacity-100 ${
              document.starred
                ? "text-yellow-400 opacity-100"
                : "text-gray-400 md:opacity-0"
            }`}
            title={document.starred ? t("documents.unstar") : t("documents.star")}
          >
            <Star
              className="h-4 w-4"
              fill={document.starred ? "currentColor" : "none"}
            />
          </button>
        )}

        {/* Menu */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMenuClick?.(document);
          }}
          className={`rounded p-1 transition hover:bg-gray-100 ${
            isHovered ? "opacity-100" : "opacity-100 md:opacity-0"
          }`}
        >
          <MoreVertical className="h-4 w-4 text-gray-600" />
        </button>
      </div>

      {/* THUMBNAIL */}
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-gray-100">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={document.title || document.original_filename}
            className="h-full w-full object-cover"
          />
        ) : (
          <Icon className={`h-12 w-12 ${iconColor}`} />
        )}
        {(document.processing_status === "pending" ||
          document.processing_status === "processing") && (
          <div className="absolute bottom-1 left-1 z-10 flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-xs text-gray-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("documents.processing")}
          </div>
        )}
        {document.processing_status === "failed" && (
          <div className="absolute bottom-1 left-1 z-10 flex items-center gap-1 rounded bg-red-50/90 px-1.5 py-0.5 text-xs text-red-600">
            <AlertCircle className="h-3 w-3" />
            {t("documents.processingFailed")}
          </div>
        )}
      </div>
    </div>
  );
}
