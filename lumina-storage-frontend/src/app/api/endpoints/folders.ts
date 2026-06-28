import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import type { FolderResponse, FolderCreateRequest } from "@/app/types/api";
import type {
  DocumentPermissionResponse,
  DocumentPermissionCreateRequest,
  DocumentPermissionUpdateRequest,
} from "@/app/types/documentPermission";

export const foldersApi = {
  list(params?: { parentId?: string; sharedWithMe?: boolean }) {
    const query: Record<string, string | boolean> = {};
    if (params?.parentId) query.parent_id = params.parentId;
    if (params?.sharedWithMe) query.shared_with_me = true;
    return http.get<FolderResponse[]>(
      API_ENDPOINTS.folders.list,
      Object.keys(query).length ? query : undefined
    );
  },

  get(id: string) {
    return http.get<FolderResponse>(API_ENDPOINTS.folders.detail(id));
  },

  create(data: FolderCreateRequest) {
    return http.post<FolderResponse>(API_ENDPOINTS.folders.create, data);
  },

  rename(id: string, name: string) {
    return http.patch<FolderResponse>(API_ENDPOINTS.folders.update(id), { name });
  },

  delete(id: string) {
    return http.delete(API_ENDPOINTS.folders.delete(id));
  },

  // --- Permissions ---

  listPermissions(folderId: string) {
    return http.get<DocumentPermissionResponse[]>(
      API_ENDPOINTS.folders.permissions(folderId)
    );
  },

  shareFolder(folderId: string, data: DocumentPermissionCreateRequest) {
    return http.post<DocumentPermissionResponse>(
      API_ENDPOINTS.folders.permissions(folderId),
      data
    );
  },

  updatePermission(
    folderId: string,
    permId: string,
    data: DocumentPermissionUpdateRequest
  ) {
    return http.patch<DocumentPermissionResponse>(
      API_ENDPOINTS.folders.permission(folderId, permId),
      data
    );
  },

  revokePermission(folderId: string, permId: string) {
    return http.delete(API_ENDPOINTS.folders.permission(folderId, permId));
  },
};
