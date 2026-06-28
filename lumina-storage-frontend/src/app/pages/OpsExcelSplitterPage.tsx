import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { opsApi, type ExcelPreviewResponse } from "@/app/api/endpoints/ops";
import { downloadBlob, suggestSplitZipName } from "@/app/utils/opsExcel";
import { cn } from "@/app/components/ui/utils";

export function OpsExcelSplitterPage() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ExcelPreviewResponse | null>(null);
  const [groupColumn, setGroupColumn] = useState<string>("");
  const [includeSummary, setIncludeSummary] = useState(true);
  const [filePrefix, setFilePrefix] = useState("");

  const previewMutation = useMutation({
    mutationFn: (f: File) => opsApi.excelPreview(f),
    onSuccess: (data) => {
      setPreview(data);
      // Heuristic auto-pick: any column whose name contains "ncc" wins.
      const nccCol = data.columns.find((c) => /ncc/i.test(c));
      setGroupColumn(nccCol ?? data.columns[0] ?? "");
    },
    onError: () => toast.error(t("ops.readError")),
  });

  const splitMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("missing_file");
      return opsApi.excelSplit({
        file,
        group_column: groupColumn,
        include_summary: includeSummary,
        file_prefix: filePrefix.trim(),
      });
    },
    onSuccess: (blob) => {
      downloadBlob(blob, suggestSplitZipName(file?.name ?? ""));
      toast.success(t("ops.splitSuccess"));
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : t("ops.splitError");
      toast.error(msg);
    },
  });

  const handleFile = (f: File) => {
    setFile(f);
    setPreview(null);
    setGroupColumn("");
    previewMutation.mutate(f);
  };

  const handleReset = () => {
    setFile(null);
    setPreview(null);
    setGroupColumn("");
    setFilePrefix("");
    setIncludeSummary(true);
  };

  const canSplit = !!file && !!groupColumn && !splitMutation.isPending;

  return (
    <div className="flex h-full flex-col p-4 lg:p-6">
      <header className="mb-4 shrink-0">
        <h1 className="text-xl font-semibold text-gray-900">
          {t("ops.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t("ops.description")}
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {/* Step 1 — Upload */}
        <section className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:w-96">
          <h2 className="text-sm font-semibold text-gray-700">
            1. Chọn file Excel
          </h2>
          <label
            htmlFor="ops-xlsx-upload"
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center text-sm transition-colors",
              file
                ? "border-brand-300 bg-brand-50/40 text-brand-700"
                : "hover:border-brand-300 hover:bg-brand-50/30 border-gray-200 text-gray-500"
            )}
          >
            <FileSpreadsheet className="h-8 w-8" />
            {file ? (
              <>
                <span className="font-medium">{file.name}</span>
                <span className="text-xs text-gray-400">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              </>
            ) : (
              <>
                <span>Click để chọn .xlsx / .xlsm</span>
                <span className="text-xs text-gray-400">
                  Sales gửi sao thì upload nguyên xi
                </span>
              </>
            )}
            <input
              id="ops-xlsx-upload"
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) handleFile(f);
              }}
            />
          </label>

          {file && (
            <button
              onClick={handleReset}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Chọn file khác
            </button>
          )}

          {previewMutation.isPending && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Đang đọc file…
            </div>
          )}
        </section>

        {/* Step 2 — Configure + preview */}
        <section className="flex min-h-0 flex-1 flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700">
            2. Chọn cột phân nhóm
          </h2>

          {!preview ? (
            <p className="text-sm text-gray-400">
              Upload file ở bước 1 để xem cột.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Cột phân nhóm
                  </label>
                  <select
                    value={groupColumn}
                    onChange={(e) => setGroupColumn(e.target.value)}
                    className="focus:border-brand-400 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
                  >
                    {preview.columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-gray-400">
                    Tìm thấy {preview.total_rows} dòng dữ liệu trong sheet "
                    {preview.sheet_name}".
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Tiền tố tên file (tuỳ chọn)
                  </label>
                  <input
                    value={filePrefix}
                    onChange={(e) => setFilePrefix(e.target.value)}
                    placeholder="VD: NCC_"
                    className="focus:border-brand-400 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none"
                  />
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={includeSummary}
                      onChange={(e) => setIncludeSummary(e.target.checked)}
                    />
                    Kèm file 00_TONG_HOP.xlsx (gửi DVVC)
                  </label>
                </div>
              </div>

              {/* Sample preview */}
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-100">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-left">
                    <tr>
                      {preview.columns.map((c) => (
                        <th
                          key={c}
                          className={cn(
                            "border-b border-gray-200 px-2 py-1.5 font-medium text-gray-600",
                            c === groupColumn && "bg-brand-50 text-brand-700"
                          )}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample_rows.map((row, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        {preview.columns.map((c) => (
                          <td
                            key={c}
                            className={cn(
                              "px-2 py-1 text-gray-700",
                              c === groupColumn && "bg-brand-50/40 font-medium"
                            )}
                          >
                            {String(row[c] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="shrink-0">
                <button
                  onClick={() => splitMutation.mutate()}
                  disabled={!canSplit}
                  className="bg-brand-500 hover:bg-brand-600 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {splitMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Tách & tải ZIP
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
