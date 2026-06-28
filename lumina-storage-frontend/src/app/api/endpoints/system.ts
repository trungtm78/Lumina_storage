import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import type {
  SystemConfigResponse,
  PublicConfigResponse,
  SystemConfigCreateRequest,
  SystemConfigUpdateRequest,
} from "@/app/types/api";

// ── Public (no auth required) ──

export const publicConfigApi = {
  list() {
    return http.get<PublicConfigResponse[]>(
      API_ENDPOINTS.system.publicConfigs,
      undefined,
      { skipAuth: true }
    );
  },
};

// ── Storage Quota (public read, admin write) ──

export const storageQuotaApi = {
  get() {
    return http.get<{ max_gb: number }>(API_ENDPOINTS.system.storageQuota);
  },

  update(max_gb: number) {
    return http.put<{ max_gb: number }>(API_ENDPOINTS.system.storageQuota, { max_gb });
  },
};

// ── Admin (superuser) endpoints ──

export const systemConfigApi = {
  list() {
    return http.get<SystemConfigResponse[]>(API_ENDPOINTS.system.configs);
  },

  get(key: string) {
    return http.get<SystemConfigResponse>(
      API_ENDPOINTS.system.configDetail(key)
    );
  },

  create(data: SystemConfigCreateRequest) {
    return http.post<SystemConfigResponse>(API_ENDPOINTS.system.configs, data);
  },

  update(key: string, data: SystemConfigUpdateRequest) {
    return http.patch<SystemConfigResponse>(
      API_ENDPOINTS.system.configDetail(key),
      data
    );
  },

  delete(key: string) {
    return http.delete(API_ENDPOINTS.system.configDetail(key));
  },
};
