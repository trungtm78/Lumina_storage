import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import type { DashboardStats, ProcessingFile, RecentFile, SharedFile } from "@/app/types/dashboard";

export const dashboardApi = {
  stats() {
    return http.get<DashboardStats>(API_ENDPOINTS.dashboard.stats);
  },

  recentFiles() {
    return http.get<RecentFile[]>(API_ENDPOINTS.dashboard.recentFiles);
  },

  processingData() {
    return http.get<ProcessingFile[]>(API_ENDPOINTS.dashboard.processingData);
  },

  sharedFiles() {
    return http.get<SharedFile[]>(API_ENDPOINTS.dashboard.sharedFiles);
  },

  downloadReport() {
    return http.get<Blob>(API_ENDPOINTS.dashboard.report, undefined, {
      responseType: "blob",
    });
  },
};
