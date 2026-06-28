import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import type { BackgroundTaskResponse, TaskListParams } from "@/app/types/api";

export const tasksApi = {
  list(params?: TaskListParams) {
    return http.get<{
      items: BackgroundTaskResponse[];
      total: number;
      page: number;
      page_size: number;
    }>(API_ENDPOINTS.tasks.list, params);
  },

  ping() {
    return http.post<BackgroundTaskResponse>(API_ENDPOINTS.tasks.ping);
  },

  get(id: string) {
    return http.get<BackgroundTaskResponse>(API_ENDPOINTS.tasks.detail(id));
  },
};
