export const UPLOAD_ALLOWED_EXTENSIONS = [
  ".pdf",
  ".doc", ".docx",
  ".xls", ".xlsx",
  ".ppt", ".pptx",
  ".txt", ".md", ".csv", ".tsv",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".html", ".json",
  ".rtf", ".odt", ".ods", ".odp",
] as const;

export const UPLOAD_ALLOWED_FORMATS_LABEL = UPLOAD_ALLOWED_EXTENSIONS
  .map((ext) => ext.slice(1).toUpperCase())
  .join(", ");

export const UPLOAD_MAX_SIZE_MB = 100;

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function bytesToGB(bytes: number): number {
  return bytes / (1024 * 1024 * 1024);
}

export function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function getFileTypeFromExtension(
  ext: string
): "pdf" | "image" | "doc" | "xls" | "video" | "txt" {
  const e = ext.toLowerCase().replace(/^\./, "");
  if (e === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"].includes(e))
    return "image";
  if (["doc", "docx", "odt", "rtf"].includes(e)) return "doc";
  if (["xls", "xlsx", "csv", "ods"].includes(e)) return "xls";
  if (["mp4", "avi", "mov", "mkv", "webm"].includes(e)) return "video";
  return "txt";
}
