import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import type {
  StorageConfigResponse,
  StorageConfigCreateRequest,
  StorageConfigUpdateRequest,
  UserStorageConfigCreateRequest,
} from "@/app/types/api";

export const storageInfoApi = {
  uploadLimits() {
    return http.get<{ max_upload_size_mb: number }>(API_ENDPOINTS.storage.uploadLimits);
  },
};

// ── Admin (superuser) endpoints ──

export const storageApi = {
  list() {
    return http.get<StorageConfigResponse[]>(API_ENDPOINTS.storage.configs);
  },

  create(data: StorageConfigCreateRequest) {
    return http.post<StorageConfigResponse>(
      API_ENDPOINTS.storage.configs,
      data
    );
  },

  update(id: string, data: StorageConfigUpdateRequest) {
    return http.patch<StorageConfigResponse>(
      API_ENDPOINTS.storage.configDetail(id),
      data
    );
  },

  delete(id: string) {
    return http.delete(API_ENDPOINTS.storage.configDetail(id));
  },

  setDefault(id: string) {
    return http.post<StorageConfigResponse>(
      API_ENDPOINTS.storage.setDefault(id)
    );
  },

  testConnection(data: Partial<StorageConfigCreateRequest>) {
    return http.post<{ success: boolean; message: string }>(
      API_ENDPOINTS.storage.testConnection,
      data
    );
  },
};

// ── User personal config endpoints ──

export const myStorageApi = {
  list() {
    return http.get<StorageConfigResponse[]>(API_ENDPOINTS.storage.myConfigs);
  },

  create(data: UserStorageConfigCreateRequest) {
    return http.post<StorageConfigResponse>(
      API_ENDPOINTS.storage.myConfigs,
      data
    );
  },

  update(id: string, data: StorageConfigUpdateRequest) {
    return http.patch<StorageConfigResponse>(
      API_ENDPOINTS.storage.myConfigDetail(id),
      data
    );
  },

  delete(id: string) {
    return http.delete(API_ENDPOINTS.storage.myConfigDetail(id));
  },
};
