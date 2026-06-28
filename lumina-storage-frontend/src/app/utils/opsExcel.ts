/**
 * Suggest a download filename for the split ZIP based on the original Excel
 * filename. `data.xlsx` → `data_split.zip`.
 */
export function suggestSplitZipName(originalFilename: string): string {
  const trimmed = (originalFilename ?? "").trim();
  if (!trimmed) return "split.zip";
  const dot = trimmed.lastIndexOf(".");
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return `${stem}_split.zip`;
}

/** Trigger a browser download for an in-memory Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
