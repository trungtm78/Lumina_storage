import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import { axiosClient } from "@/app/api/client";
import { documentsApi } from "@/app/api/endpoints/documents";

export type TemplateFieldType =
  | "date"
  | "blank"
  | "placeholder"
  | "label_empty"
  | "empty"
  | "select"
  | "textarea"
  | "number";

export type LanguageMode = "single" | "bilingual";

export interface TemplateSection {
  key: string;
  label: string;
  order: number;
}

export interface TemplateField {
  id: string;
  placeholder: string;
  label: string;
  description?: string;
  location: string;
  type: string;
  /** Required when `type === "select"`. */
  options?: string[] | null;
  /** Section grouping key — must match a `TemplateSection.key`. */
  section_key?: string | null;
  /** Explicit required flag. `null` = legacy (required when type !== "blank"). */
  required?: boolean | null;
}

// Draft field shape from LLM — uses `name` instead of `placeholder` + has `current`
export interface DraftField {
  id: string;
  name: string;
  label: string;
  description: string;
  type: string;
  current: string;
  location: string;
}

export interface TemplateDraft {
  fields: DraftField[];
  doc_description: string;
  source_document_id: string;
}

export interface DraftStatusResponse {
  status: "pending" | "running" | "success" | "failure" | "none";
  task_id: string | null;
  draft: TemplateDraft | null;
  error: string | null;
}

export interface TemplateResponse {
  id: string;
  title: string;
  description: string | null;
  original_filename: string;
  source_document_id: string | null;
  template_fields: TemplateField[];
  extraction_status: string | null;
  extraction_error: string | null;
  field_count: number;
  language_mode: LanguageMode;
  sections: TemplateSection[];
  created_at: string;
  updated_at: string;
}

export interface PaginatedTemplatesResponse {
  items: TemplateResponse[];
  has_more: boolean;
}

export const templatesApi = {
  list(params?: { q?: string; limit?: number; offset?: number }) {
    return http.get<PaginatedTemplatesResponse>(
      API_ENDPOINTS.templates.list,
      params
    );
  },

  get(id: string) {
    return http.get<TemplateResponse>(API_ENDPOINTS.templates.detail(id));
  },

  update(
    id: string,
    data: {
      description?: string;
      language_mode?: LanguageMode;
      sections?: TemplateSection[];
    }
  ) {
    return http.patch<TemplateResponse>(
      API_ENDPOINTS.templates.detail(id),
      data
    );
  },

  updateFields(
    id: string,
    fields: {
      id: string;
      placeholder: string;
      label: string;
      description?: string;
      type?: string;
      options?: string[] | null;
      section_key?: string | null;
      required?: boolean | null;
    }[]
  ) {
    return http.put<TemplateResponse>(API_ENDPOINTS.templates.fields(id), {
      fields,
    });
  },

  uploadFile(id: string, buffer: ArrayBuffer) {
    return axiosClient.put<TemplateResponse>(
      API_ENDPOINTS.templates.file(id),
      buffer,
      {
        headers: { "Content-Type": "application/octet-stream" },
      }
    );
  },

  rescan(id: string) {
    return http.post<TemplateResponse>(
      `${API_ENDPOINTS.templates.detail(id)}/rescan`
    );
  },

  extract(documentId: string, description?: string) {
    return http.post<{ status: string; job_id: string | null }>(
      API_ENDPOINTS.templates.extract(documentId),
      undefined,
      { params: description ? { description } : undefined }
    );
  },

  extractDraft(documentId: string) {
    return http.post<{ status: string; task_id: string }>(
      API_ENDPOINTS.templates.extractDraft(documentId)
    );
  },

  getDraft(documentId: string) {
    return http.get<DraftStatusResponse>(
      API_ENDPOINTS.templates.draft(documentId)
    );
  },

  commit(
    documentId: string,
    body: { fields: DraftField[]; doc_description?: string }
  ) {
    return http.post<TemplateResponse>(
      API_ENDPOINTS.templates.commit(documentId),
      body
    );
  },

  /**
   * Hard-delete a template: soft-delete (move to trash) then bulk-purge from trash.
   * Backend cascades: Qdrant vectors, storage file, DB row.
   */
  async hardDelete(id: string) {
    await documentsApi.delete(id);
    return documentsApi.bulkPermanentDelete([id]);
  },
};
