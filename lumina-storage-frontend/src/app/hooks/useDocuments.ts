import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { documentsApi } from "@/app/api/endpoints/documents";
import type {
  DocumentResponse,
  DocumentListParams,
  TrashListParams,
  FolderResponse,
  PaginatedResponse,
} from "@/app/types/api";

export function useDocuments(params?: DocumentListParams) {
  return useQuery({
    queryKey: ["documents", params],
    queryFn: () => documentsApi.list(params),
    staleTime: (query) => {
      const data = query.state.data as
        | PaginatedResponse<DocumentResponse>
        | undefined;
      const hasProcessing = data?.items?.some(
        (d) =>
          d.processing_status === "pending" ||
          d.processing_status === "processing"
      );
      // When documents are processing, always refetch on mount so the
      // spinner disappears promptly after navigating back from Tasks page.
      return hasProcessing ? 0 : 5 * 60 * 1000;
    },
    refetchInterval: (query) => {
      const data = query.state.data as
        | PaginatedResponse<DocumentResponse>
        | undefined;
      const hasProcessing = data?.items?.some(
        (d) =>
          d.processing_status === "pending" ||
          d.processing_status === "processing"
      );
      return hasProcessing ? 3000 : false;
    },
  });
}

export function useTrashDocuments(params?: TrashListParams) {
  return useQuery({
    queryKey: ["documents", "trash", params],
    queryFn: () => documentsApi.listTrash(params),
  });
}

export function useRestoreDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => documentsApi.restore(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function usePermanentDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => documentsApi.permanentDelete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", "trash"] });
    },
  });
}

export function useBulkPermanentDelete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => documentsApi.bulkPermanentDelete(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", "trash"] });
    },
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: ["documents", id],
    queryFn: () => documentsApi.get(id),
    enabled: !!id,
  });
}

export function useUploadDocuments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: FormData) => documentsApi.upload(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useUploadFolder(currentFolderId?: string | null) {
  const queryClient = useQueryClient();
  const foldersQueryKey = ["folders", currentFolderId ?? null];

  return useMutation({
    mutationFn: ({ formData }: { formData: FormData; folderName: string }) =>
      documentsApi.uploadFolder(formData),

    onMutate: async ({ folderName }) => {
      await queryClient.cancelQueries({ queryKey: foldersQueryKey });
      const previousFolders =
        queryClient.getQueryData<FolderResponse[]>(foldersQueryKey);

      const optimisticFolder: FolderResponse = {
        id: `temp-${Date.now()}`,
        name: folderName,
        parent_id: currentFolderId ?? null,
        path: "",
        owner_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      queryClient.setQueryData<FolderResponse[]>(foldersQueryKey, (old) => [
        optimisticFolder,
        ...(old ?? []),
      ]);

      return { previousFolders };
    },

    onError: (_err, _vars, context) => {
      if (context?.previousFolders) {
        queryClient.setQueryData(foldersQueryKey, context.previousFolders);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
}

export function useBulkDeleteDocuments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (documentIds: string[]) => documentsApi.bulkDelete(documentIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useRenameDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      documentsApi.update(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useMoveDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) =>
      documentsApi.move(id, folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useToggleStar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => documentsApi.toggleStar(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["documents"] });
      const queries = queryClient.getQueriesData<
        PaginatedResponse<DocumentResponse>
      >({
        queryKey: ["documents"],
      });

      for (const [key, data] of queries) {
        if (data && "items" in data) {
          queryClient.setQueryData<PaginatedResponse<DocumentResponse>>(key, {
            ...data,
            items: data.items.map((d) =>
              d.id === id ? { ...d, starred: !d.starred } : d
            ),
          });
        }
      }

      return { queries };
    },

    onError: (_err, _id, context) => {
      if (context?.queries) {
        for (const [key, data] of context.queries) {
          queryClient.setQueryData(key, data);
        }
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useDeleteDocument(params?: DocumentListParams) {
  const queryClient = useQueryClient();
  const queryKey = ["documents", params];

  return useMutation({
    mutationFn: (id: string) => documentsApi.delete(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<PaginatedResponse<DocumentResponse>>(queryKey);

      queryClient.setQueryData<PaginatedResponse<DocumentResponse>>(
        queryKey,
        (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((d) => d.id !== id),
            total: old.total - 1,
          };
        }
      );

      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
