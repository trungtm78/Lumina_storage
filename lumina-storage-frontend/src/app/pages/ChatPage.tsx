import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PanelLeftOpen, Send, ChevronDown, Star, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { CitationSource, SkillResult } from "@/app/types/chat";
import type { Document } from "@/app/types/document";
import {
  useSessions,
  useMessages,
  useCreateSession,
  useDeleteSession,
  useChatModels,
} from "@/app/hooks/useChat";
import { chatApi } from "@/app/api/endpoints/chat";
import { documentsApi } from "@/app/api/endpoints/documents";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";
import { ChatSidebar } from "../components/chat/ChatSidebar";
import { ChatHeader } from "../components/chat/ChatHeader";
import { ChatMessageList } from "../components/chat/ChatMessageList";
import { ChatInput } from "../components/chat/ChatInput";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { DocumentPreviewModal } from "../components/document/DocumentPreviewModal";

export function ChatPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const {
    data: sessionsData,
    fetchNextPage: fetchMoreSessions,
    hasNextPage: hasMoreSessions,
    isFetchingNextPage: isFetchingMoreSessions,
  } = useSessions();
  const sessions = sessionsData?.pages.flatMap((p) => p.items) ?? [];

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );

  const {
    data: messagesData,
    fetchPreviousPage,
    hasPreviousPage,
    isFetchingPreviousPage,
  } = useMessages(selectedSessionId);
  const messages = (messagesData?.pages.flatMap((p) => p.items) ?? []).sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const { data: chatModels = [] } = useChatModels();

  const [message, setMessage] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [heroModelPopoverOpen, setHeroModelPopoverOpen] = useState(false);

  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(
    null
  );
  const [pendingAttachments, setPendingAttachments] = useState<
    { document_id: string; filename: string; extension: string }[] | null
  >(null);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [streamingSources, setStreamingSources] = useState<CitationSource[]>(
    []
  );
  const [streamingSkillDone, setStreamingSkillDone] =
    useState<SkillResult | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Track whether user has sent a message in the current session view.
  // Prevents isEmpty from flipping true during the brief window after stream ends
  // but before the messages refetch returns (stale data = []).
  const [hasSentMessage, setHasSentMessage] = useState(false);

  const [citationPreview, setCitationPreview] = useState<{
    doc: Document;
    page: number | null;
  } | null>(null);

  const [attachedFile, setAttachedFile] = useState<File | null>(null);

  const handleCitationClick = useCallback(
    async (documentId: string, pageNumber: number | null) => {
      try {
        const doc = await documentsApi.get(documentId);
        setCitationPreview({ doc, page: pageNumber });
      } catch {
        toast.error(t("chat.cannotOpenDocument"));
      }
    },
    []
  );

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);

  const scrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const handleScrollContainer = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 80 && hasPreviousPage && !isFetchingPreviousPage) {
      prevScrollHeightRef.current = el.scrollHeight;
      fetchPreviousPage();
    }
  };

  // Auto-select default model
  useEffect(() => {
    if (chatModels.length > 0 && !selectedModelId) {
      const def = chatModels.find((m) => m.is_default) ?? chatModels[0];
      setSelectedModelId(def.id);
    }
  }, [chatModels, selectedModelId]);

  // Auto-select first session on load
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  // Reset per-session state when switching sessions
  useEffect(() => {
    setHasSentMessage(false);
    isAtBottomRef.current = true;
    setTimeout(scrollToBottom, 0);
  }, [selectedSessionId]);

  // Scroll to bottom when messages reload, only if user is at bottom
  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [messages]);

  // Restore scroll position after older messages are prepended
  useEffect(() => {
    if (!isFetchingPreviousPage && prevScrollHeightRef.current > 0) {
      const el = scrollContainerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
        prevScrollHeightRef.current = 0;
      }
    }
  }, [isFetchingPreviousPage]);

  // Scroll to show the new user message right after it renders
  useEffect(() => {
    if (pendingUserMessage !== null) scrollToBottom();
  }, [pendingUserMessage]);

  const selectedSession =
    sessions.find((s) => s.id === selectedSessionId) ?? null;

  const handleSelectSession = (id: string) => {
    setSelectedSessionId(id);
    setIsSidebarOpen(false);
  };

  const handleNewSession = async () => {
    try {
      const session = await createSession.mutateAsync({});
      setSelectedSessionId(session.id);
      setIsSidebarOpen(false);
    } catch {
      toast.error(t("chat.createSessionFailed"));
    }
  };

  const handleDeleteSessionRequest = (_id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteSessionId(_id);
  };

  const handleDeleteSessionConfirm = async () => {
    if (!deleteSessionId) return;
    try {
      await deleteSession.mutateAsync(deleteSessionId);
      if (selectedSessionId === deleteSessionId) {
        const remaining = sessions.filter((s) => s.id !== deleteSessionId);
        setSelectedSessionId(remaining[0]?.id ?? null);
      }
    } catch {
      toast.error(t("chat.deleteSessionFailed"));
    }
    setDeleteSessionId(null);
  };

  const handleSendMessage = async () => {
    if (!message.trim() || isStreaming) return;

    let sessionId = selectedSessionId;

    if (!sessionId) {
      try {
        const session = await createSession.mutateAsync({});
        sessionId = session.id;
        setSelectedSessionId(session.id);
      } catch {
        toast.error(t("chat.createSessionFailed"));
        return;
      }
    }

    const content = message.trim();
    setMessage("");
    setPendingUserMessage(content);
    setHasSentMessage(true);

    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);
    setStreamingContent("");
    setStreamingSkillDone(null);
    isAtBottomRef.current = true;

    let full = "";
    let rafId: number | null = null;
    const flush = () => {
      setStreamingContent(full);
      rafId = null;
    };

    try {
      // Upload attached file if any
      let uploadedDocIds: string[] | undefined;
      if (attachedFile) {
        const fileName = attachedFile.name;
        const fileExt = fileName.split(".").pop() || "";
        try {
          const formData = new FormData();
          formData.append("files", attachedFile);
          formData.append("source_type", "chat_attachment");
          const docs = await documentsApi.upload(formData);
          if (docs.length > 0) {
            uploadedDocIds = [docs[0].id];
            setPendingAttachments([
              {
                document_id: docs[0].id,
                filename: fileName,
                extension: fileExt,
              },
            ]);
          }
        } catch {
          toast.error(t("chat.uploadFileFailed"));
          setIsStreaming(false);
          setPendingUserMessage(null);
          setPendingAttachments(null);
          abortRef.current = null;
          return;
        }
        setAttachedFile(null);
      }

      const payload = uploadedDocIds
        ? {
            content,
            model_id: selectedModelId ?? undefined,
            document_ids: uploadedDocIds,
          }
        : { content, model_id: selectedModelId ?? undefined };

      for await (const ev of chatApi.sendMessage(
        sessionId,
        payload,
        controller.signal
      )) {
        if (ev.chunk) {
          full += ev.chunk;
          if (rafId === null) rafId = requestAnimationFrame(flush);
        }
        if (ev.sources) setStreamingSources(ev.sources);
        if (ev.skillDone) {
          setStreamingSkillDone({
            rendered_document_id: ev.skillDone.renderedDocumentId,
            preview_pdf_id: ev.skillDone.previewPdfId,
            applied_count: ev.skillDone.appliedCount,
          });
        }
        if (ev.done) break;
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        toast.error(t("chat.sendMessageFailed"));
      }
    }

    if (rafId !== null) cancelAnimationFrame(rafId);
    setStreamingContent(null);
    setStreamingSources([]);
    setStreamingSkillDone(null);
    setIsStreaming(false);
    setPendingUserMessage(null);
    setPendingAttachments(null);
    abortRef.current = null;

    queryClient.invalidateQueries({
      queryKey: ["chat", "messages", sessionId],
    });
    // Delay sessions refetch so sidebar doesn't jitter right as stream ends
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
    }, 1500);
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  // messagesData is undefined until the first fetch returns for the current session.
  const isMessagesLoaded = messagesData !== undefined;
  // isEmpty = true only when we're certain this is a genuinely empty session:
  // - no session selected (no sessionId), OR
  // - messages loaded and truly empty AND user hasn't sent anything yet this view
  // hasSentMessage prevents isEmpty from flipping true after stream ends while
  // the refetch is still in-flight (stale data = [], messages.length === 0).
  const isEmpty =
    (isMessagesLoaded ? messages.length === 0 && !hasSentMessage : selectedSessionId === null) &&
    pendingUserMessage === null &&
    !isStreaming;
  const activeModel =
    chatModels.find((m) => m.id === selectedModelId) ??
    chatModels.find((m) => m.is_default) ??
    null;

  return (
    <div
      className={`flex w-full min-w-0 ${
        isMaximized ? "fixed inset-0 z-50" : "h-full"
      }`}
    >
      <ChatSidebar
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        isOpen={isSidebarOpen}
        isMaximized={isMaximized}
        isCollapsed={isSidebarCollapsed}
        isCreating={createSession.isPending}
        hasMore={!!hasMoreSessions}
        isFetchingMore={isFetchingMoreSessions}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSessionRequest}
        onClose={() => setIsSidebarOpen(false)}
        onCollapse={() => setIsSidebarCollapsed(true)}
        onLoadMore={() => fetchMoreSessions()}
      />

      {/* Main */}
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[#f7f7f8]">
        {/* Floating expand button */}
        {!isMaximized && isSidebarCollapsed && (
          <button
            onClick={() => setIsSidebarCollapsed(false)}
            className="absolute top-[4.5rem] left-3 z-10 hidden items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white/95 px-2.5 py-1.5 text-xs font-medium text-gray-500 shadow-[0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-sm transition-all hover:bg-white hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)] lg:flex"
          >
            <PanelLeftOpen className="h-4 w-4" />
            <span>{t("chat.conversations")}</span>
          </button>
        )}

        {/* Header */}
        <ChatHeader
          title={selectedSession?.title ?? null}
          isMaximized={isMaximized}
          isCreating={createSession.isPending}
          onToggleMaximize={() => setIsMaximized(!isMaximized)}
          onOpenSidebar={() => setIsSidebarOpen(true)}
          onNewSession={handleNewSession}
        />

        {/* Content */}
        <AnimatePresence mode="wait" initial={false}>
        {isEmpty ? (
          /* ── Empty state hero ── */
          <motion.div
            key="hero"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="flex-1 overflow-y-auto bg-[radial-gradient(80%_80%_at_50%_0%,#FFF4F4_0%,rgba(255,244,244,0.92)_14%,#FFFFFF_38%,#FFFFFF_72%)] px-4 py-6 md:py-8">
            <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col items-center justify-center">
              {/* Hero title */}
              <div className="mb-6 text-center md:mb-10">
                <h1 className="text-2xl font-bold leading-[1.15] tracking-[-0.03em] text-[#111] md:text-[38px]">
                  {t("chat.multiDoc")
                    .split(" ")
                    .map((word, i) =>
                      word.toLowerCase() === "ai" ? (
                        <span key={i} className="text-brand-500">
                          {word}{" "}
                        </span>
                      ) : (
                        word + " "
                      ),
                    )}
                </h1>
                <p className="mx-auto mt-2 max-w-[540px] text-sm leading-6 text-[#6f6f6f] md:mt-3 md:text-base">
                  {t("chat.multiDocSubtitle")}
                </p>
              </div>

              {/* Input card */}
              <div className="mx-auto w-full max-w-[760px]">
                {/* Outer card */}
                <div className="rounded-[28px] border border-[rgba(0,0,0,0.08)] bg-white/95 p-0 shadow-[0_20px_60px_rgba(0,0,0,0.06)] backdrop-blur-xl md:p-2 lg:p-4">
                  {/* Inner card */}
                  <div className="rounded-[22px] border border-[rgba(0,0,0,0.05)] bg-[#fcfcfd] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder={t("chat.multiDocPlaceholder")}
                      rows={2}
                      className="h-[52px] w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-7 text-[#222] placeholder:text-[#8b8b95] focus:outline-none"
                    />
                    <div className="mt-4 flex items-center justify-end">
                      <button
                        onClick={handleSendMessage}
                        disabled={!message.trim() || isStreaming}
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 ${
                          message.trim()
                            ? "bg-brand-500 text-white shadow-md hover:scale-[1.02] hover:shadow-lg"
                            : "bg-[#f1f1f4] text-[#c8c8cf]"
                        }`}
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Model picker pill — below the card */}
                {chatModels.length > 0 && (
                  <div className="mt-3 flex items-center justify-center">
                    <Popover open={heroModelPopoverOpen} onOpenChange={setHeroModelPopoverOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-medium text-[#7a7a7a] shadow-sm ring-1 ring-[rgba(0,0,0,0.06)] transition-all hover:bg-white hover:ring-[rgba(0,0,0,0.12)]"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                          <span className="max-w-[160px] truncate">{activeModel?.name ?? "Default"}</span>
                          <ChevronDown className="h-3 w-3 opacity-40" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="center" side="bottom" className="w-[280px] p-0">
                        <div className="border-b px-3 py-2">
                          <p className="text-xs font-semibold">AI Model</p>
                        </div>
                        <div className="max-h-[240px] overflow-y-auto py-1">
                          {chatModels.map((model) => {
                            const isActive = (selectedModelId ?? chatModels.find((m) => m.is_default)?.id) === model.id;
                            return (
                              <button
                                key={model.id}
                                type="button"
                                onClick={() => {
                                  setSelectedModelId(model.id);
                                  setHeroModelPopoverOpen(false);
                                }}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted/50 ${isActive ? "bg-muted/50" : ""}`}
                              >
                                <span className="flex-1 truncate text-left">
                                  {model.name}
                                  {model.is_default && (
                                    <Star className="ml-1 inline h-3 w-3 fill-yellow-400 text-yellow-400" />
                                  )}
                                </span>
                                {isActive && <Check className="text-brand-500 h-3.5 w-3.5 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}

              </div>
            </div>
          </motion.div>
        ) : (
          /* ── Chat with messages ── */
          <motion.div
            key="chat"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="mx-4 mb-4 mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/60 bg-white/80 shadow-lg shadow-gray-200/50 backdrop-blur-sm"
          >
            <ChatMessageList
              ref={scrollContainerRef}
              messages={messages}
              pendingUserMessage={pendingUserMessage}
              pendingAttachments={pendingAttachments}
              streamingContent={streamingContent}
              streamingSources={streamingSources}
              streamingSkillDone={streamingSkillDone}
              isFetchingPreviousPage={isFetchingPreviousPage}
              hasSession={!!selectedSession || attachedFile != null}
              isStreaming={isStreaming}
              isLoading={!isMessagesLoaded || (hasSentMessage && messages.length === 0)}
              onScroll={handleScrollContainer}
              onCitationClick={handleCitationClick}
            />
            <ChatInput
              message={message}
              isStreaming={isStreaming}
              models={chatModels}
              selectedModelId={selectedModelId}
              onMessageChange={setMessage}
              onSend={handleSendMessage}
              onStop={handleStop}
              onModelChange={setSelectedModelId}
            />
          </motion.div>
        )}
        </AnimatePresence>
      </main>

      <ConfirmDeleteModal
        open={!!deleteSessionId}
        onClose={() => setDeleteSessionId(null)}
        onConfirm={handleDeleteSessionConfirm}
        title={t("chat.deleteSession")}
        description={t("chat.deleteSessionDescription", {
          title:
            sessions.find((s) => s.id === deleteSessionId)?.title ??
            t("chat.thisConversation"),
        })}
        confirmLabel={t("common.delete")}
        isLoading={deleteSession.isPending}
      />

      <DocumentPreviewModal
        document={citationPreview?.doc ?? null}
        documents={citationPreview ? [citationPreview.doc] : []}
        open={citationPreview !== null}
        onClose={() => setCitationPreview(null)}
        initialPage={citationPreview?.page}
      />
    </div>
  );
}
