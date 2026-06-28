import { forwardRef, useCallback, useMemo, useState, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  MessageSquare,
  Bot,
  User,
  ChevronDown,
  Paperclip,
  Download,
  X,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import ReactMarkdown from "react-markdown";
import type {
  ChatMessageResponse,
  CitationSource,
  SkillResult,
} from "@/app/types/chat";
import { axiosClient } from "@/app/api/client";
import { FileAttachmentCard } from "./FileAttachmentCard";

interface ChatMessageListProps {
  messages: ChatMessageResponse[];
  pendingUserMessage: string | null;
  pendingAttachments?:
    | { document_id: string; filename: string; extension: string }[]
    | null;
  streamingContent: string | null;
  streamingSources: CitationSource[];
  streamingSkillDone?: SkillResult | null;
  isFetchingPreviousPage: boolean;
  hasSession: boolean;
  isStreaming: boolean;
  isLoading?: boolean;
  onScroll: () => void;
  onCitationClick?: (documentId: string, pageNumber: number | null) => void;
}

export const ChatMessageList = forwardRef<HTMLDivElement, ChatMessageListProps>(
  function ChatMessageList(
    {
      messages,
      pendingUserMessage,
      pendingAttachments,
      streamingContent,
      streamingSources,
      streamingSkillDone,
      isFetchingPreviousPage,
      hasSession,
      isStreaming,
      isLoading = false,
      onScroll,
      onCitationClick,
    },
    ref
  ) {
    const [showScrollBtn, setShowScrollBtn] = useState(false);

    const handleScroll = useCallback(() => {
      onScroll();
      const el = typeof ref === "function" ? null : ref?.current;
      if (el) {
        setShowScrollBtn(
          el.scrollHeight - el.scrollTop - el.clientHeight > 120
        );
      }
    }, [onScroll, ref]);

    const scrollToBottom = useCallback(() => {
      const el = typeof ref === "function" ? null : ref?.current;
      el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, [ref]);

    const isEmpty =
      messages.length === 0 &&
      pendingUserMessage === null &&
      streamingContent === null &&
      !isStreaming;

    return (
      <div className="relative min-h-0 flex-1">
        <div
          ref={ref}
          onScroll={handleScroll}
          className="h-full overflow-y-auto p-3 sm:p-6"
        >
          {isEmpty ? (
            isLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
              </div>
            ) : (
              <ChatEmptyState hasSession={hasSession} />
            )
          ) : (
            <div className="mx-auto w-full space-y-4">
              {isFetchingPreviousPage && (
                <div className="flex justify-center py-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                </div>
              )}

              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onCitationClick={onCitationClick}
                />
              ))}

              {pendingUserMessage !== null && (
                <UserBubble
                  content={pendingUserMessage}
                  attachments={pendingAttachments}
                />
              )}

              {isStreaming && (
                <>
                  <AssistantBubble
                    content={streamingContent}
                    sources={streamingSources}
                    modelUsed={null}
                    time={null}
                    isStreaming={true}
                    onCitationClick={onCitationClick}
                  />
                  {streamingSkillDone &&
                    streamingSkillDone.rendered_document_id && (
                      <FileAttachmentCard
                        renderedDocumentId={
                          streamingSkillDone.rendered_document_id
                        }
                        previewPdfId={streamingSkillDone.preview_pdf_id}
                        appliedCount={streamingSkillDone.applied_count}
                      />
                    )}
                </>
              )}
            </div>
          )}
        </div>

        {showScrollBtn && (
          <ScrollToBottomBtn onClick={scrollToBottom} />
        )}
      </div>
    );
  }
);

/* ───────── Bubble components ───────── */

function UserBubble({
  content,
  time,
  attachments,
}: {
  content: string;
  time?: string | null;
  attachments?:
    | { document_id: string; filename: string; extension: string }[]
    | null;
}) {
  return (
    <div className="flex items-start gap-3 justify-end">
      <div className="min-w-0 flex-1 max-w-full sm:max-w-3xl text-right">
        {attachments && attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
            {attachments.map((att) => (
              <AttachmentChip key={att.document_id} attachment={att} />
            ))}
          </div>
        )}
        <div className="inline-block max-w-full rounded-2xl rounded-tr-md bg-red-500 px-4 py-3 shadow-lg shadow-red-500/20 sm:px-5 sm:py-3.5">
          <p className="text-xs leading-6 text-white sm:text-sm">{content}</p>
        </div>
        {time && (
          <p className="mt-1 text-xs text-gray-400 sm:mt-2">{time}</p>
        )}
      </div>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 shadow-sm">
        <User className="h-4 w-4 text-gray-600" />
      </div>
    </div>
  );
}

function AssistantBubble({
  content,
  sources,
  modelUsed,
  time,
  isStreaming = false,
  onCitationClick,
}: {
  content: string | null;
  sources: CitationSource[];
  modelUsed: string | null;
  time: string | null;
  isStreaming?: boolean;
  onCitationClick?: (documentId: string, pageNumber: number | null) => void;
}) {
  const sourceMap = useMemo(
    () => new Map(sources.map((s) => [s.citation_index, s])),
    [sources]
  );

  return (
    <div className="flex items-start gap-3">
      <div className="bg-brand-50 border-brand-100 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-sm">
        <Bot className="text-brand-500 h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 max-w-full sm:max-w-3xl">
        <div className="inline-block max-w-full rounded-2xl rounded-tl-md border border-gray-200/60 bg-gradient-to-br from-gray-50 to-white px-4 py-3 shadow-sm sm:px-5 sm:py-3.5">
          {content ? (
            <div className="prose prose-sm prose-headings:text-gray-900 prose-p:leading-7 prose-li:leading-7 prose-pre:bg-gray-50 prose-pre:text-xs prose-code:text-red-600 prose-code:before:content-none prose-code:after:content-none max-w-none break-words text-gray-800">
              {isStreaming ? (
                <StreamingMarkdown
                  content={content}
                  sourceMap={sourceMap}
                  onCitationClick={onCitationClick}
                />
              ) : (
                <MarkdownWithCitations
                  content={content}
                  sourceMap={sourceMap}
                  onCitationClick={onCitationClick}
                />
              )}
            </div>
          ) : (
            <TypingDots />
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-gray-400 sm:mt-2">
          {time && <span>{time}</span>}
          {modelUsed && (
            <>
              {time && <span>·</span>}
              <Bot className="h-3 w-3" />
              <span>{modelUsed}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatMessage({
  message,
  onCitationClick,
}: {
  message: ChatMessageResponse;
  onCitationClick?: (documentId: string, pageNumber: number | null) => void;
}) {
  const time = format(parseISO(message.created_at), "HH:mm");
  if (message.role === "user") {
    return (
      <UserBubble
        content={message.content}
        time={time}
        attachments={message.attachments}
      />
    );
  }
  return (
    <>
      <AssistantBubble
        content={message.content}
        sources={message.sources ?? []}
        modelUsed={message.model_used}
        time={time}
        onCitationClick={onCitationClick}
      />
      {message.skill_result && message.skill_result.rendered_document_id && (
        <FileAttachmentCard
          renderedDocumentId={message.skill_result.rendered_document_id}
          previewPdfId={message.skill_result.preview_pdf_id}
          appliedCount={message.skill_result.applied_count}
        />
      )}
    </>
  );
}

/* ───────── Markdown with citation support ───────── */

function MarkdownWithCitations({
  content,
  sourceMap,
  onCitationClick,
}: {
  content: string;
  sourceMap: Map<number, CitationSource>;
  onCitationClick?: (documentId: string, pageNumber: number | null) => void;
}) {
  return (
    <ReactMarkdown
      components={{
        // Override paragraph to inject citation pills
        p: ({ children }) => {
          return (
            <p>{processCitations(children, sourceMap, onCitationClick)}</p>
          );
        },
        li: ({ children }) => {
          return (
            <li>{processCitations(children, sourceMap, onCitationClick)}</li>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

/* ───────── Stable-block streaming markdown ───────── */
// Splits content at the last paragraph/block boundary so that:
// - "stable" completed blocks are memoized → ReactMarkdown only re-runs when a new block finishes
// - "unstable" current incomplete block streams as plain text → virtually free re-renders
// This is how ChatGPT achieves smooth markdown streaming.

const StableMarkdown = memo(function StableMarkdown({
  content,
  sourceMap,
  onCitationClick,
}: {
  content: string;
  sourceMap: Map<number, CitationSource>;
  onCitationClick?: (documentId: string, pageNumber: number | null) => void;
}) {
  if (!content) return null;
  return (
    <MarkdownWithCitations
      content={content}
      sourceMap={sourceMap}
      onCitationClick={onCitationClick}
    />
  );
});

function StreamingMarkdown({
  content,
  sourceMap,
  onCitationClick,
}: {
  content: string;
  sourceMap: Map<number, CitationSource>;
  onCitationClick?: (documentId: string, pageNumber: number | null) => void;
}) {
  // Find the last double-newline (paragraph/block boundary).
  // Everything before it is "stable" (complete blocks), everything after is "unstable" (current incomplete block).
  const lastBreak = content.lastIndexOf("\n\n");
  const stable = lastBreak >= 0 ? content.slice(0, lastBreak + 2) : "";
  const unstable = lastBreak >= 0 ? content.slice(lastBreak + 2) : content;

  return (
    <>
      <StableMarkdown
        content={stable}
        sourceMap={sourceMap}
        onCitationClick={onCitationClick}
      />
      {unstable && (
        <span className="whitespace-pre-wrap">{unstable}</span>
      )}
    </>
  );
}

function processCitations(
  children: React.ReactNode,
  sourceMap: Map<number, CitationSource>,
  onCitationClick?: (documentId: string, pageNumber: number | null) => void
): React.ReactNode {
  if (!children) return children;

  const processNode = (node: React.ReactNode): React.ReactNode => {
    if (typeof node === "string") {
      const parts = node.split(/(\[\d+\])/g);
      if (parts.length <= 1) return node;
      return parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (match) {
          const idx = parseInt(match[1], 10);
          const source = sourceMap.get(idx);
          if (source) {
            return (
              <button
                key={i}
                onClick={() =>
                  onCitationClick?.(source.document_id, source.page_number)
                }
                className="mx-0.5 inline-flex items-center rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-100"
                title={`${source.document_title} (p.${source.page_number})`}
              >
                {part}
              </button>
            );
          }
        }
        return part;
      });
    }
    if (Array.isArray(node)) {
      return node.map((n, i) => <span key={i}>{processNode(n)}</span>);
    }
    return node;
  };

  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <span key={i}>{processNode(child)}</span>
    ));
  }
  return processNode(children);
}

/* ───────── (CitationPill removed — citations now handled inline by MarkdownWithCitations) ───────── */

/* ───────── Typing dots ───────── */

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-2 w-2 rounded-full bg-gray-400"
          style={{
            animation: "typing-bounce 1.4s infinite ease-in-out both",
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes typing-bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}

/* ───────── Attachment chip with preview ───────── */

function AttachmentChip({
  attachment,
}: {
  attachment: { document_id: string; filename: string; extension: string };
}) {
  const { t } = useTranslation();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    try {
      const resp = await axiosClient.get<Blob>(
        `/documents/${attachment.document_id}/download`,
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  };

  const handleClick = async () => {
    setLoading(true);
    try {
      const ext = attachment.extension?.toLowerCase().replace(".", "");
      if (ext === "pdf" || ext === "txt" || ext === "csv") {
        // These render natively in iframe
        const resp = await axiosClient.get<Blob>(
          `/documents/${attachment.document_id}/preview`,
          { responseType: "blob" }
        );
        setPreviewUrl(URL.createObjectURL(resp.data));
      } else {
        // DOCX, XLSX, PPTX etc — convert to PDF via /preview-pdf endpoint
        const resp = await axiosClient.get<Blob>(
          `/documents/${attachment.document_id}/preview-pdf`,
          { responseType: "blob" }
        );
        setPreviewUrl(URL.createObjectURL(resp.data));
      }
    } catch {
      // Fallback: try raw preview
      try {
        const resp = await axiosClient.get<Blob>(
          `/documents/${attachment.document_id}/preview`,
          { responseType: "blob" }
        );
        setPreviewUrl(URL.createObjectURL(resp.data));
      } catch {
        handleDownload();
      }
    }
    setLoading(false);
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={loading}
        className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
      >
        <Paperclip className="h-3 w-3" />
        {attachment.filename}
      </button>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closePreview}
        >
          <div
            className="relative flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-medium">{attachment.filename}</h3>
              <div className="flex gap-2">
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  <Download className="h-3 w-3" /> {t("common.download")}
                </button>
                <button
                  onClick={closePreview}
                  className="rounded-lg p-1.5 hover:bg-gray-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <iframe
              src={previewUrl}
              className="flex-1 bg-gray-50"
              title="Preview"
            />
          </div>
        </div>
      )}
    </>
  );
}

/* ───────── Scroll to bottom button ───────── */

function ScrollToBottomBtn({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className="absolute right-4 bottom-4 flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white shadow-lg transition-all hover:bg-gray-50 active:scale-95"
      title={t("chat.scrollToBottom")}
    >
      <ChevronDown className="h-5 w-5 text-gray-600" />
    </button>
  );
}

/* ───────── Empty state ───────── */

function ChatEmptyState({ hasSession }: { hasSession: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-2xl px-2 text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 sm:h-20 sm:w-20">
            <MessageSquare className="h-8 w-8 text-red-500 sm:h-10 sm:w-10" />
          </div>
        </div>
        <h2 className="mb-3 text-xl font-semibold text-gray-900 sm:text-2xl">
          {hasSession ? t("chat.startConversation") : t("chat.selectConversation")}
        </h2>
        <p className="text-sm leading-6 text-gray-500 sm:text-base">
          {hasSession
            ? t("chat.startConversationHint")
            : t("chat.selectConversationHint")}
        </p>
      </div>
    </div>
  );
}
