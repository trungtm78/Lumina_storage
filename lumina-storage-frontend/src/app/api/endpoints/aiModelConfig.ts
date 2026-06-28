import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import type {
  AIModelConfigResponse,
  AIModelConfigCreateRequest,
  AIModelConfigUpdateRequest,
  AIModelConfigTestRequest,
  AIModelConfigTestResponse,
} from "@/app/types/aiModelConfig";

export const aiModelConfigApi = {
  listPublic(purpose?: string) {
    return http.get<AIModelConfigResponse[]>(
      API_ENDPOINTS.aiModelConfigs.public,
      purpose ? { purpose } : undefined
    );
  },

  listAll() {
    return http.get<AIModelConfigResponse[]>(API_ENDPOINTS.aiModelConfigs.list);
  },

  create(data: AIModelConfigCreateRequest) {
    return http.post<AIModelConfigResponse>(
      API_ENDPOINTS.aiModelConfigs.list,
      data
    );
  },

  update(id: string, data: AIModelConfigUpdateRequest) {
    return http.patch<AIModelConfigResponse>(
      API_ENDPOINTS.aiModelConfigs.detail(id),
      data
    );
  },

  delete(id: string) {
    return http.delete<void>(API_ENDPOINTS.aiModelConfigs.detail(id));
  },

  setDefault(id: string) {
    return http.patch<AIModelConfigResponse>(
      API_ENDPOINTS.aiModelConfigs.setDefault(id),
      {}
    );
  },

  test(data: AIModelConfigTestRequest) {
    return http.post<AIModelConfigTestResponse>(
      API_ENDPOINTS.aiModelConfigs.test,
      data
    );
  },
};
