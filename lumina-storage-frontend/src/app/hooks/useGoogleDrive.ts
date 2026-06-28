import { useMutation, useQueryClient } from "@tanstack/react-query";
import { googleDriveApi } from "@/app/api/endpoints/googleDrive";
import type { GoogleDriveImportRequest } from "@/app/types/api";

export function useGoogleDriveImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: GoogleDriveImportRequest) => {
      const results = await googleDriveApi.import(data);
      if (results.every((r) => r.status === "failed")) {
        throw new Error(results[0]?.error_message ?? "Import failed");
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
