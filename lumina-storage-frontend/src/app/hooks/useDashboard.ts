import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/app/api/endpoints/dashboard";
import { documentsApi } from "@/app/api/endpoints/documents";
import type { ProcessingFile } from "@/app/types/dashboard";

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: () => dashboardApi.stats(),
    staleTime: 2 * 60 * 1000,
  });
}

export function useDashboardRecentFiles() {
  return useQuery({
    queryKey: ["dashboard", "recent-files"],
    queryFn: () => dashboardApi.recentFiles(),
    staleTime: 2 * 60 * 1000,
  });
}

export function useDashboardProcessingData() {
  return useQuery({
    queryKey: ["dashboard", "processing-data"],
    queryFn: () => dashboardApi.processingData(),
    refetchInterval: (query) => {
      const data = query.state.data as ProcessingFile[] | undefined;
      const hasActive = data?.some(
        (f) => f.status === "processing" || f.status === "pending"
      );
      return hasActive ? 3000 : false;
    },
  });
}

export function useDashboardSharedFiles() {
  return useQuery({
    queryKey: ["dashboard", "shared-files"],
    queryFn: async () => {
      const res = await documentsApi.list({
        shared_with_me: true,
        page_size: 5,
        sort_by: "updated_at",
        sort_order: "desc",
      });
      return (res.items ?? []).map((doc) => ({
        id: doc.id,
        title: doc.title,
        extension: doc.extension,
        owner_name: doc.uploader_name,
        updated_at: doc.updated_at,
      }));
    },
    staleTime: 2 * 60 * 1000,
  });
}
