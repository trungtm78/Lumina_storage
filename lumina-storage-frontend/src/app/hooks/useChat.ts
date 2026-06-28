import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { chatApi } from "@/app/api/endpoints/chat";
import { aiModelConfigApi } from "@/app/api/endpoints/aiModelConfig";
import type { ChatSessionCreateRequest } from "@/app/types/api";

export function useSessions() {
  return useInfiniteQuery({
    queryKey: ["chat", "sessions"],
    queryFn: ({ pageParam }) =>
      chatApi.listSessions({ limit: 20, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.has_more ? lastPageParam + lastPage.items.length : undefined,
  });
}

export function useSessionSearch(query: string) {
  return useQuery({
    queryKey: ["chat", "sessions", "search", query],
    queryFn: () => chatApi.listSessions({ limit: 50, q: query }),
    enabled: query.trim().length > 0,
    staleTime: 10_000,
  });
}

export function useMessages(sessionId: string | null) {
  return useInfiniteQuery({
    queryKey: ["chat", "messages", sessionId],
    queryFn: ({ pageParam }) =>
      chatApi.getMessages(sessionId!, { limit: 50, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    // "previous page" = older messages, prepended when user scrolls up
    getPreviousPageParam: (firstPage) =>
      firstPage.has_more ? firstPage.items[0]?.id : undefined,
    getNextPageParam: () => undefined,
    enabled: !!sessionId,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data?: ChatSessionCreateRequest) =>
      chatApi.createSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => chatApi.deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
    },
  });
}

export function useChatModels() {
  return useQuery({
    queryKey: ["aiModelConfigs", "chat"],
    queryFn: () => aiModelConfigApi.listPublic("chat"),
  });
}
