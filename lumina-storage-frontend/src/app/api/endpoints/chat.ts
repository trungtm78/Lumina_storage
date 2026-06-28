import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import { useAuthStore } from "@/app/stores/authStore";
import { axiosClient } from "@/app/api/client";
import type {
  ChatSessionResponse,
  ChatSessionCreateRequest,
  ChatMessageCreateRequest,
  UpdateSessionRequest,
  PaginatedSessionsResponse,
  PaginatedMessagesResponse,
  CitationSource,
} from "@/app/types/api";

export interface SkillDoneEvent {
  renderedDocumentId: string;
  previewPdfId: string | null;
  appliedCount: number;
}

export const chatApi = {
  createSession(data?: ChatSessionCreateRequest) {
    return http.post<ChatSessionResponse>(API_ENDPOINTS.chat.sessions, data);
  },

  listSessions(params?: { limit?: number; offset?: number; q?: string }) {
    return http.get<PaginatedSessionsResponse>(
      API_ENDPOINTS.chat.sessions,
      params
    );
  },

  deleteSession(sessionId: string) {
    return http.delete<void>(API_ENDPOINTS.chat.session(sessionId));
  },

  updateSession(sessionId: string, data: UpdateSessionRequest) {
    return http.patch<ChatSessionResponse>(
      API_ENDPOINTS.chat.session(sessionId),
      data
    );
  },

  getMessages(sessionId: string, params?: { limit?: number; before?: string }) {
    return http.get<PaginatedMessagesResponse>(
      API_ENDPOINTS.chat.messages(sessionId),
      params
    );
  },

  sendMessage(
    sessionId: string,
    data: ChatMessageCreateRequest,
    signal?: AbortSignal
  ) {
    return fetchEventSource(
      API_ENDPOINTS.chat.messages(sessionId),
      data,
      signal
    );
  },
};

/**
 * SSE stream helper for chat messages.
 * Yields chunks, sources, and skill_done events as they arrive.
 */
async function* fetchEventSource(
  path: string,
  body: ChatMessageCreateRequest,
  signal?: AbortSignal
): AsyncGenerator<{
  chunk?: string;
  done?: boolean;
  sources?: CitationSource[];
  skillDone?: SkillDoneEvent;
  skillStart?: {
    documentId: string;
    documentTitle: string;
    originalFilename: string;
  };
}> {
  const baseURL = axiosClient.defaults.baseURL ?? "";
  const { accessToken } = useAuthStore.getState();

  const response = await fetch(`${baseURL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Chat request failed with status ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEventType = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith("event: ")) {
          currentEventType = trimmed.slice(7);
        } else if (trimmed.startsWith("data: ")) {
          const json = trimmed.slice(6);
          try {
            const data = JSON.parse(json);
            if (
              currentEventType === "content_block_delta" &&
              data.delta?.type === "text_delta" &&
              data.delta?.text
            ) {
              yield { chunk: data.delta.text as string };
            } else if (currentEventType === "message_stop") {
              yield { done: true };
            } else if (
              currentEventType === "sources" &&
              Array.isArray(data.sources)
            ) {
              yield { sources: data.sources as CitationSource[] };
            } else if (
              currentEventType === "skill_done" &&
              data.rendered_document_id
            ) {
              yield {
                skillDone: {
                  renderedDocumentId: data.rendered_document_id as string,
                  previewPdfId: (data.preview_pdf_id as string) ?? null,
                  appliedCount: (data.applied_count as number) ?? 0,
                },
              };
            } else if (currentEventType === "skill_start" && data.document_id) {
              yield {
                skillStart: {
                  documentId: data.document_id as string,
                  documentTitle: (data.document_title as string) ?? "",
                  originalFilename: (data.original_filename as string) ?? "",
                },
              };
            }
          } catch {
            // skip malformed
          }
        } else if (trimmed === "") {
          currentEventType = "";
        }
      }
    }
  } finally {
    reader.cancel();
  }
}
