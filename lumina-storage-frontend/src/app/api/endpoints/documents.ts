import { http } from "@/app/api/http";
import { axiosClient } from "@/app/api/client";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import type {
  DocumentResponse,
  DocumentListParams,
  DocumentUploadFolderResponse,
  BackgroundTaskResponse,
  PaginatedResponse,
  TrashListParams,
} from "@/app/types/api";
import type {
  DocumentPermissionResponse,
  DocumentPermissionCreateRequest,
  DocumentPermissionUpdateRequest,
} from "@/app/types/documentPermission";

export const documentsApi = {
  list(params?: DocumentListParams) {
    return http.get<PaginatedResponse<DocumentResponse>>(
      API_ENDPOINTS.documents.list,
      params
    );
  },

  get(id: string) {
    return http.get<DocumentResponse>(API_ENDPOINTS.documents.detail(id));
  },

  upload(data: FormData, config?: { signal?: AbortSignal }) {
    return http.post<DocumentResponse[]>(API_ENDPOINTS.documents.upload, data, config);
  },

  uploadFolder(data: FormData) {
    return http.post<DocumentUploadFolderResponse>(
      API_ENDPOINTS.documents.uploadFolder,
      data
    );
  },

  delete(id: string) {
    return http.delete(API_ENDPOINTS.documents.delete(id));
  },

  bulkDelete(documentIds: string[]) {
    return http.delete<{ deleted: number }>(
      API_ENDPOINTS.documents.bulkDelete,
      {
        data: { document_ids: documentIds },
      }
    );
  },

  update(id: string, data: { title?: string }) {
    return http.patch<DocumentResponse>(API_ENDPOINTS.documents.update(id), data);
  },

  move(id: string, folderId: string | null) {
    return http.patch<DocumentResponse>(API_ENDPOINTS.documents.move(id), {
      folder_id: folderId,
    });
  },

  toggleStar(id: string) {
    return http.post<DocumentResponse>(API_ENDPOINTS.documents.star(id));
  },

  listTrash(params?: TrashListParams) {
    return http.get<PaginatedResponse<DocumentResponse>>(
      API_ENDPOINTS.documents.trash,
      params
    );
  },

  restore(id: string) {
    return http.post<DocumentResponse>(API_ENDPOINTS.documents.restore(id));
  },

  permanentDelete(id: string) {
    return http.delete(API_ENDPOINTS.documents.permanentDelete(id));
  },

  bulkPermanentDelete(documentIds: string[]) {
    return http.delete<{ deleted: number }>(
      API_ENDPOINTS.documents.trashBulkDelete,
      {
        data: { document_ids: documentIds },
      }
    );
  },

  process(id: string) {
    return http.post<BackgroundTaskResponse>(
      API_ENDPOINTS.documents.process(id)
    );
  },

  processStatus(id: string) {
    return http.get<BackgroundTaskResponse>(
      API_ENDPOINTS.documents.processStatus(id)
    );
  },

  previewUrl(id: string) {
    return `${axiosClient.defaults.baseURL}${API_ENDPOINTS.documents.preview(id)}`;
  },

  downloadUrl(id: string) {
    return `${axiosClient.defaults.baseURL}${API_ENDPOINTS.documents.download(id)}`;
  },

  async download(id: string, filename: string) {
    const res = await axiosClient.get(API_ENDPOINTS.documents.download(id), {
      responseType: "blob",
    });
    // Prefer the filename from Content-Disposition (backend sets correct extension).
    // Falls back to the caller-supplied filename when the header is absent or unparseable.
    const cd: string = res.headers['content-disposition'] ?? '';
    const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const asciiMatch = cd.match(/filename="([^"]+)"/i);
    const serverFilename = utf8Match
      ? decodeURIComponent(utf8Match[1])
      : asciiMatch
      ? asciiMatch[1]
      : null;
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = serverFilename ?? filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  },

  // --- Permissions ---

  listPermissions(documentId: string) {
    return http.get<DocumentPermissionResponse[]>(
      API_ENDPOINTS.documents.permissions(documentId)
    );
  },

  shareDocument(documentId: string, data: DocumentPermissionCreateRequest) {
    return http.post<DocumentPermissionResponse>(
      API_ENDPOINTS.documents.permissions(documentId),
      data
    );
  },

  updatePermission(
    documentId: string,
    permId: string,
    data: DocumentPermissionUpdateRequest
  ) {
    return http.patch<DocumentPermissionResponse>(
      API_ENDPOINTS.documents.permission(documentId, permId),
      data
    );
  },

  revokePermission(documentId: string, permId: string) {
    return http.delete(API_ENDPOINTS.documents.permission(documentId, permId));
  },

  templateUsage(documentId: string) {
    return http.get<{ draft_session_count: number }>(
      `/documents/${documentId}/template-usage`
    );
  },
};
