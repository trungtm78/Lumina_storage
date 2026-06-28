import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { documentsApi } from "@/app/api/endpoints/documents";
import type {
  DocumentPermissionCreateRequest,
  DocumentPermissionUpdateRequest,
} from "@/app/types/documentPermission";

export function useDocumentPermissions(documentId: string | undefined) {
  return useQuery({
    queryKey: ["document-permissions", documentId],
    queryFn: () => documentsApi.listPermissions(documentId!),
    enabled: !!documentId,
  });
}

export function useShareDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      data,
    }: {
      documentId: string;
      data: DocumentPermissionCreateRequest;
    }) => documentsApi.shareDocument(documentId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["document-permissions", variables.documentId],
      });
    },
  });
}

export function useUpdateDocumentPermission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      permId,
      data,
    }: {
      documentId: string;
      permId: string;
      data: DocumentPermissionUpdateRequest;
    }) => documentsApi.updatePermission(documentId, permId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["document-permissions", variables.documentId],
      });
    },
  });
}

export function useRevokeDocumentPermission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      permId,
    }: {
      documentId: string;
      permId: string;
    }) => documentsApi.revokePermission(documentId, permId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["document-permissions", variables.documentId],
      });
    },
  });
}
