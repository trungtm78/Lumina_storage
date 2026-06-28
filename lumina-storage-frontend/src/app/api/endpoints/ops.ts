import { http } from "@/app/api/http";
import { axiosClient } from "@/app/api/client";
import { API_ENDPOINTS } from "@/app/api/endpoints";

export interface ExcelPreviewResponse {
  columns: string[];
  sample_rows: Record<string, string | number | null>[];
  total_rows: number;
  sheet_name: string;
}

export const opsApi = {
  excelPreview(file: File) {
    const form = new FormData();
    form.append("file", file);
    return http.post<ExcelPreviewResponse>(
      API_ENDPOINTS.ops.excelPreview,
      form
    );
  },

  async excelSplit(data: {
    file: File;
    group_column: string;
    include_summary?: boolean;
    file_prefix?: string;
  }): Promise<Blob> {
    const form = new FormData();
    form.append("file", data.file);
    form.append("group_column", data.group_column);
    form.append("include_summary", String(data.include_summary ?? true));
    if (data.file_prefix) form.append("file_prefix", data.file_prefix);

    const resp = await axiosClient.post<Blob>(
      API_ENDPOINTS.ops.excelSplit,
      form,
      { responseType: "blob" }
    );
    return resp.data;
  },
};
