// Phase 5b — API client cấu hình provider trích xuất (mirror aiModelConfig).
import { API_ENDPOINTS } from "@/app/api/endpoints";
import { http } from "@/app/api/http";
import type {
  ExtractionProviderConfigCreateRequest,
  ExtractionProviderConfigResponse,
  ExtractionProviderConfigTestRequest,
  ExtractionProviderConfigTestResponse,
  ExtractionProviderConfigUpdateRequest,
} from "@/app/types/extractionProviderConfig";

export const extractionProviderConfigApi = {
  listAll() {
    return http.get<ExtractionProviderConfigResponse[]>(
      API_ENDPOINTS.extractionProviderConfigs.list,
    );
  },

  available() {
    return http.get<string[]>(
      API_ENDPOINTS.extractionProviderConfigs.available,
    );
  },

  create(data: ExtractionProviderConfigCreateRequest) {
    return http.post<ExtractionProviderConfigResponse>(
      API_ENDPOINTS.extractionProviderConfigs.list,
      data,
    );
  },

  update(id: string, data: ExtractionProviderConfigUpdateRequest) {
    return http.patch<ExtractionProviderConfigResponse>(
      API_ENDPOINTS.extractionProviderConfigs.detail(id),
      data,
    );
  },

  delete(id: string) {
    return http.delete<void>(
      API_ENDPOINTS.extractionProviderConfigs.detail(id),
    );
  },

  setDefault(id: string) {
    return http.patch<ExtractionProviderConfigResponse>(
      API_ENDPOINTS.extractionProviderConfigs.setDefault(id),
      {},
    );
  },

  test(data: ExtractionProviderConfigTestRequest) {
    return http.post<ExtractionProviderConfigTestResponse>(
      API_ENDPOINTS.extractionProviderConfigs.test,
      data,
    );
  },
};
