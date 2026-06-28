import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { foldersApi } from "@/app/api/endpoints/folders";
import type { FolderCreateRequest, FolderResponse } from "@/app/types/api";

export function useFolders(
  parentId?: string | null,
  options?: { sharedWithMe?: boolean; enabled?: boolean }
) {
  const sharedWithMe = options?.sharedWithMe ?? false;
  return useQuery({
    queryKey: ["folders", parentId ?? null, sharedWithMe],
    queryFn: () =>
      foldersApi.list({ parentId: parentId ?? undefined, sharedWithMe }),
    enabled: options?.enabled ?? true,
  });
}

export function useFolder(id: string) {
  return useQuery({
    queryKey: ["folders", "detail", id],
    queryFn: () => foldersApi.get(id),
    enabled: !!id,
  });
}

export function useFolderBreadcrumb(folderId: string | null): FolderResponse[] {
  const q0 = useFolder(folderId ?? "");
  const q1 = useFolder(q0.data?.parent_id ?? "");
  const q2 = useFolder(q1.data?.parent_id ?? "");
  const q3 = useFolder(q2.data?.parent_id ?? "");
  const q4 = useFolder(q3.data?.parent_id ?? "");

  if (!folderId) return [];

  const segments: FolderResponse[] = [];
  for (const q of [q4, q3, q2, q1, q0]) {
    if (q.data) segments.push(q.data);
  }

  // The chain from root to current: find where root starts (parent_id === null)
  const rootIdx = segments.findIndex((f) => f.parent_id === null);
  return rootIdx === -1 ? segments : segments.slice(rootIdx);
}

export function useCreateFolder(currentFolderId?: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ["folders", currentFolderId ?? null];

  return useMutation({
    mutationFn: (data: FolderCreateRequest) => foldersApi.create(data),

    onMutate: async (newFolder) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FolderResponse[]>(queryKey);

      const optimistic: FolderResponse = {
        id: `temp-${Date.now()}`,
        name: newFolder.name,
        parent_id: newFolder.parent_id ?? null,
        path: "",
        owner_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      queryClient.setQueryData<FolderResponse[]>(queryKey, (old) => [
        optimistic,
        ...(old ?? []),
      ]);

      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
}

export function useRenameFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      foldersApi.rename(id, name),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
}

export function useDeleteFolder(currentFolderId?: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ["folders", currentFolderId ?? null];

  return useMutation({
    mutationFn: (id: string) => foldersApi.delete(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FolderResponse[]>(queryKey);

      queryClient.setQueryData<FolderResponse[]>(queryKey, (old) =>
        old?.filter((f) => f.id !== id)
      );

      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
}
