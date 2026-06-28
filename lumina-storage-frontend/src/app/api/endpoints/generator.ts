import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";

export interface GenerateRequest {
  template_id: string;
  field_values: Record<string, string>;
  output_filename?: string;
  folder_id?: string | null;
}

export interface ExtractFromFileResponse {
  field_values: Record<string, string>;
  extracted_count: number;
  /** Map of placeholder → filename that provided the value */
  sources?: Record<string, string>;
  /** Files that couldn't be parsed (empty or unsupported) */
  skipped_files?: string[];
}

export interface GenerateResponse {
  document_id: string;
  original_filename: string;
  preview_pdf_id: string | null;
  applied_count: number;
}

export interface GeneratedDocument {
  id: string;
  title: string;
  original_filename: string;
  created_at: string;
  template_id: string | null;
}

export interface DraftRequest {
  doc_type: string;
  description: string;
  /** Phase 3: IDs of approved reference documents whose text the LLM should use as context. */
  reference_document_ids?: string[];
  /** Phase 3: force `single` (Vietnamese only) or `bilingual` (VN + EN side by side). */
  language?: "single" | "bilingual";
}

export interface DraftResponse {
  content: string;
  version: number;
  label: string;
  /** Subset of `reference_document_ids` that actually contributed to the prompt. */
  references_used?: string[];
}

export interface ReviseRequest {
  content: string;
  instruction: string;
  version: number;
}

export interface ReviseResponse {
  content: string;
  version: number;
  label: string;
}

export interface ColumnMapping {
  column: string;
  placeholder: string;
}

/**
 * Curated dropdown values for `select` template fields. Keys are stable
 * preset identifiers (e.g. `payment_method`); values are the localized
 * display strings to choose from.
 */
export type FieldPresets = Record<string, string[]>;

export interface MapColumnsResponse {
  columns: string[];
  mapping: ColumnMapping[];
  sample_row: Record<string, string>;
  total_rows: number;
}

export const generatorApi = {
  generate(data: GenerateRequest) {
    return http.post<GenerateResponse>(API_ENDPOINTS.generator.generate, data);
  },

  async renderPdf(data: { template_id: string; field_values: Record<string, string> }): Promise<Blob> {
    const { axiosClient } = await import("@/app/api/client");
    const resp = await axiosClient.post<Blob>(
      API_ENDPOINTS.generator.renderPdf,
      data,
      { responseType: "blob" }
    );
    return resp.data;
  },

  history(params?: { limit?: number; offset?: number }) {
    return http.get<{ items: GeneratedDocument[] }>(
      API_ENDPOINTS.generator.history,
      params
    );
  },

  fieldPresets() {
    return http.get<FieldPresets>(API_ENDPOINTS.generator.fieldPresets);
  },

  draft(data: DraftRequest) {
    return http.post<DraftResponse>(API_ENDPOINTS.generator.draft, data);
  },

  revise(data: ReviseRequest) {
    return http.post<ReviseResponse>(API_ENDPOINTS.generator.revise, data);
  },

  mapColumns(data: { template_id: string; instruction?: string; file: File }) {
    const form = new FormData();
    form.append("template_id", data.template_id);
    form.append("instruction", data.instruction ?? "");
    form.append("file", data.file);
    return http.post<MapColumnsResponse>(
      API_ENDPOINTS.generator.mapColumns,
      form
    );
  },

  extractFromFile(data: { template_id: string; files: File[] }) {
    const form = new FormData();
    form.append("template_id", data.template_id);
    for (const f of data.files) {
      form.append("files", f);
    }
    return http.post<ExtractFromFileResponse>(
      API_ENDPOINTS.generator.extractFromFile,
      form
    );
  },

  extractFromText(data: {
    template_id?: string;
    field_hints?: Array<{ placeholder: string; label: string; description?: string }>;
    text: string;
  }) {
    return http.post<ExtractFromFileResponse>(
      API_ENDPOINTS.generator.extractFromText,
      data
    );
  },

  draftToTemplate(data: {
    content: string;
    title: string;
    description?: string;
  }) {
    return http.post<{
      template_id: string;
      title: string;
      field_count: number;
      template_fields: {
        placeholder: string;
        label: string;
        type: string;
        location: string;
      }[];
    }>(API_ENDPOINTS.generator.draftToTemplate, data);
  },

  async batchGenerate(data: {
    template_id: string;
    column_mapping: ColumnMapping[];
    file: File;
  }): Promise<Blob> {
    const form = new FormData();
    form.append("template_id", data.template_id);
    form.append("column_mapping", JSON.stringify(data.column_mapping));
    form.append("file", data.file);
    const { axiosClient } = await import("@/app/api/client");
    const resp = await axiosClient.post<Blob>(
      API_ENDPOINTS.generator.batch,
      form,
      { responseType: "blob" }
    );
    return resp.data;
  },
};

// ─── Generator Sessions ────────────────────────────────────────────────────────

export interface GeneratorSessionResponse {
  id: string;
  status: "draft" | "completed" | "failed";
  doc_type: string;
  title: string | null;
  field_values: Record<string, string>;
  template_id: string | null;
  document_id: string | null;
  folder_id: string | null;
  error_message: string | null;
  edited_html: string | null;
  created_at: string;
  updated_at: string;
  template_exists: boolean;
}

export interface DocumentToTemplateResponse {
  template_id: string;
  title: string;
  field_count: number;
  /** Số giá trị AI phát hiện (field_count = số gắn được token thật). */
  detected_count?: number;
  template_fields: Array<{
    id: string;
    placeholder: string;
    label: string;
    type: string;
    required: boolean | null;
    description?: string;
    options?: string[] | null;
    location: string;
  }>;
}

export const generatorSessionsApi = {
  create(data: {
    template_id?: string;
    doc_type: string;
    field_values: Record<string, string>;
    title?: string;
    folder_id?: string;
  }) {
    return http.post<GeneratorSessionResponse>("/generator/sessions", data);
  },

  update(id: string, data: { field_values?: Record<string, string>; title?: string; folder_id?: string | null; edited_html?: string }) {
    return http.patch<GeneratorSessionResponse>(`/generator/sessions/${id}`, data);
  },

  generate(
    id: string,
    data?: {
      output_filename?: string;
      folder_id?: string;
      output_format?: string;
      /** Phase 2: tạo từ một version đã lưu (ưu tiên) hoặc HTML đã sửa trực tiếp. */
      version_id?: string;
      edited_html?: string;
      /** Bỏ qua backend validation required fields — khi user đã confirm tạo dù trường trống. */
      skip_field_validation?: boolean;
    },
  ) {
    return http.post<GeneratorSessionResponse>(
      `/generator/sessions/${id}/generate`,
      data ?? {}
    );
  },

  list(params?: { status?: string; limit?: number; offset?: number }) {
    return http.get<{ items: GeneratorSessionResponse[]; total: number }>(
      "/generator/sessions",
      params
    );
  },

  delete(id: string) {
    return http.delete(`/generator/sessions/${id}`);
  },
};

// ─── Generator Session Versions (chỉnh sửa tay WYSIWYG) ──────────────────────

export interface GeneratorSessionVersionResponse {
  id: string;
  session_id: string;
  version_no: number;
  label: string | null;
  edited_html: string;
  field_values: Record<string, string>;
  created_at: string;
}

// ─── AI đề xuất chỉnh sửa (block-based, mức a) ───────────────────────────────

export interface BlockEditOp {
  op: "replace" | "insert_after" | "delete";
  block_id: string;
  new_text?: string | null;
  text?: string | null;
  kind?: "paragraph" | "heading" | "list_item";
  /** Backend điền để FE hiển thị diff (text gốc của block). */
  before_text?: string | null;
}

export interface AiReviseResponse {
  ops: BlockEditOp[];
  /** HTML đã áp dụng TẤT CẢ op — dùng preview nhanh khi Accept All. */
  revised_html_all: string;
  /** NGUYÊN tài liệu với từng chỗ sửa highlight tại chỗ (track-changes inline). */
  diff_html: string;
  warnings: string[];
}

export interface AiReviseApplyResponse {
  revised_html: string;
  warnings: string[];
}

export const generatorAiReviseApi = {
  /** Bước 1: LLM đề xuất ops trên HTML đang làm việc. */
  propose(sessionId: string, data: { html: string; instructions: string[] }) {
    return http.post<AiReviseResponse>(
      `/generator/sessions/${sessionId}/ai-revise`,
      data,
    );
  },
  /** Bước 2: áp dụng các op đã DUYỆT (tất định) → HTML cuối. */
  apply(sessionId: string, data: { html: string; ops: BlockEditOp[] }) {
    return http.post<AiReviseApplyResponse>(
      `/generator/sessions/${sessionId}/ai-revise/apply`,
      data,
    );
  },
};

export const generatorSessionVersionsApi = {
  create(sessionId: string, data: { edited_html: string; field_values?: Record<string, string>; label?: string }) {
    return http.post<GeneratorSessionVersionResponse>(
      `/generator/sessions/${sessionId}/versions`,
      data,
    );
  },
  list(sessionId: string, params?: { limit?: number; offset?: number }) {
    return http.get<{ items: GeneratorSessionVersionResponse[]; total: number }>(
      `/generator/sessions/${sessionId}/versions`,
      params,
    );
  },
  update(sessionId: string, versionId: string, data: { label?: string }) {
    return http.patch<GeneratorSessionVersionResponse>(
      `/generator/sessions/${sessionId}/versions/${versionId}`,
      data,
    );
  },
  delete(sessionId: string, versionId: string) {
    return http.delete(`/generator/sessions/${sessionId}/versions/${versionId}`);
  },
};

export const generatorDocToTemplateApi = {
  convert(data: { document_id: string; title?: string }, config?: { signal?: AbortSignal }) {
    return http.post<DocumentToTemplateResponse>(
      "/generator/document-to-template",
      data,
      config
    );
  },
};
