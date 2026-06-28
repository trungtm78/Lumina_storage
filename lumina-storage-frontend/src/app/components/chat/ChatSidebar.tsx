import { useState, useEffect, useRef, useCallback } from "react";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import {
  Plus,
  Trash2,
  Clock,
  MessageSquare,
  MessageCircle,
  Search,
  X,
  PanelLeftClose,
  Loader2,
} from "lucide-react";
import type { ChatSessionResponse } from "@/app/types/chat";
import { formatDistanceToNow, type Locale } from "date-fns";
import { vi as viLocale, enUS } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { cn } from "@/app/components/ui/utils";
import { useSessionSearch } from "@/app/hooks/useChat";

const AVATAR_GRADIENTS: [string, string][] = [
  ["#818CF8", "#A78BFA"],
  ["#8B5CF6", "#C084FC"],
  ["#60A5FA", "#3B82F6"],
  ["#22C1C3", "#60A5FA"],
  ["#A855F7", "#C084FC"],
  ["#34D399", "#60A5FA"],
];

function getAvatarGradient(id: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

interface ChatSidebarProps {
  sessions: ChatSessionResponse[];
  selectedSessionId: string | null;
  isOpen: boolean;
  isMaximized: boolean;
  isCollapsed: boolean;
  isCreating: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  onClose: () => void;
  onCollapse: () => void;
  onLoadMore: () => void;
}

export function ChatSidebar({
  sessions,
  selectedSessionId,
  isOpen,
  isMaximized,
  isCollapsed,
  isCreating,
  hasMore,
  isFetchingMore,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onClose,
  onCollapse,
  onLoadMore,
}: ChatSidebarProps) {
  const { t, i18n } = useTranslation();
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: searchData, isFetching: isSearching } =
    useSessionSearch(debouncedQuery);

  if (isMaximized) return null;

  const dateLocale = i18n.language === "vi" ? viLocale : enUS;
  const isSearchActive = debouncedQuery.length > 0;
  const displayedSessions = isSearchActive
    ? (searchData?.items ?? [])
    : sessions;

  const listContent = (
    <ScrollArea className="min-h-0 w-full flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
      {isSearching ? (
        <div className="flex items-center justify-center py-14">
          <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
        </div>
      ) : displayedSessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
          <MessageCircle className="mb-3 h-10 w-10 text-gray-200" />
          <p className="text-sm font-medium text-gray-500">
            {isSearchActive ? t("common.noResults") : t("chat.noSessions")}
          </p>
        </div>
      ) : (
        <SessionList
          sessions={displayedSessions}
          selectedSessionId={selectedSessionId}
          hasMore={!isSearchActive && hasMore}
          isFetchingMore={isFetchingMore}
          dateLocale={dateLocale}
          onSelect={onSelectSession}
          onDelete={onDeleteSession}
          onLoadMore={onLoadMore}
        />
      )}
    </ScrollArea>
  );

  const searchPanel = showSearch && (
    <div className="w-full shrink-0 border-b border-black/[0.06]">
      <div className="p-2.5">
        <div className="flex w-full items-center gap-2 rounded-lg border border-black/[0.08] bg-[#f5f6f8] px-3 py-1.5">
          <Search className="h-3 w-3 shrink-0 text-gray-500" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("chat.searchSessions")}
            className="flex-1 bg-transparent text-xs text-gray-900 outline-none placeholder:text-gray-400"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")}>
              <X className="h-3 w-3 text-gray-500" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <button
          type="button"
          aria-label={t("chat.closeSidebar")}
          className="fixed inset-0 z-[99] bg-black/40 backdrop-blur-[1px] lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          // Mobile: fixed, slides from right
          "fixed top-0 right-0 z-[100] h-[100dvh] w-[min(320px,calc(100vw-2rem))] flex-shrink-0 overflow-hidden overscroll-contain bg-white shadow-xl",
          // Desktop: in-flow, left side, flat panel
          "lg:relative lg:top-auto lg:right-auto lg:z-auto lg:h-full lg:shadow-none lg:order-first",
          "transition-all duration-300 ease-in-out",
          // Mobile open/close via translate
          isOpen ? "translate-x-0" : "translate-x-full",
          // Desktop always visible, collapse via width
          "lg:translate-x-0",
          isCollapsed ? "lg:w-0" : "lg:w-[280px] xl:w-[320px]",
        )}
      >
        <div className="flex h-full w-full min-w-0 flex-shrink-0 flex-col overflow-hidden border-r border-[rgba(0,0,0,0.06)] bg-white">
          {/* Header */}
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-black/[0.06] px-3">
            <div className="flex min-w-0 items-center gap-2">
              <MessageSquare className="h-4 w-4 shrink-0 text-[#6b7280]" />
              <span className="truncate text-sm font-semibold text-[#111827]">
                {t("chat.conversations")}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => {
                  setShowSearch((v) => !v);
                  setSearchQuery("");
                }}
                className="rounded-lg p-1.5 text-[#6b7280] transition-colors hover:bg-[#f3f4f6] hover:text-[#111827]"
                title={t("chat.searchSessions")}
              >
                <Search className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onNewSession}
                disabled={isCreating}
                className="bg-brand-500 hover:bg-brand-600 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-white shadow-sm transition-colors disabled:opacity-60"
              >
                <Plus className="h-3 w-3" />
                <span>{t("chat.new")}</span>
              </button>
              {/* Desktop collapse */}
              <button
                onClick={onCollapse}
                className="hidden rounded-lg p-1.5 text-[#6b7280] transition-colors hover:bg-[#f3f4f6] hover:text-[#111827] lg:block"
                title={t("chat.closeSidebar")}
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
              {/* Mobile close */}
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-[#6b7280] transition-colors hover:bg-[#f3f4f6] hover:text-[#111827] lg:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {searchPanel}
          {listContent}
        </div>
      </aside>
    </>
  );
}

function SessionList({
  sessions,
  selectedSessionId,
  hasMore,
  isFetchingMore,
  dateLocale,
  onSelect,
  onDelete,
  onLoadMore,
}: {
  sessions: ChatSessionResponse[];
  selectedSessionId: string | null;
  hasMore: boolean;
  isFetchingMore: boolean;
  dateLocale: Locale;
  onSelect: (id: string) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onLoadMore: () => void;
}) {
  const { t, i18n } = useTranslation();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleSentinel = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasMore && !isFetchingMore) {
        onLoadMore();
      }
    },
    [hasMore, isFetchingMore, onLoadMore],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(handleSentinel, {
      threshold: 0.1,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleSentinel]);

  const formatTimeAgo = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), {
        addSuffix: true,
        locale: dateLocale,
      });
    } catch {
      return "";
    }
  };

  const formatCreatedAt = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString(i18n.language, {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="w-full space-y-1.5 pb-4 pl-2 pr-4 pt-2">
      {sessions.map((session) => {
        const isActive = selectedSessionId === session.id;
        const gradient = getAvatarGradient(session.id);
        const letter = (session.title ?? t("chat.untitled")).trim().charAt(0).toUpperCase();

        return (
          <div
            key={session.id}
            className="group relative w-full overflow-hidden rounded-xl"
          >
            <button
              onClick={() => onSelect(session.id)}
              className={cn(
                "w-full cursor-pointer rounded-xl border p-3 text-left transition-colors",
                isActive
                  ? "border-brand-200 bg-brand-50"
                  : "border-transparent bg-white hover:bg-[#f5f6f8]",
              )}
            >
              <div className="flex min-w-0 items-start gap-2.5">
                {/* Gradient avatar */}
                <div
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white shadow-sm"
                  style={{
                    background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
                  }}
                >
                  {letter}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium leading-snug text-gray-900">
                    {session.title ?? t("chat.untitled")}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-gray-500">
                    {t("chat.createdAt")} {formatCreatedAt(session.created_at)}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Clock className="h-2.5 w-2.5 text-gray-400" />
                    <span className="text-[10px] text-gray-400">
                      {formatTimeAgo(session.updated_at)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Hover action pill — desktop only */}
              <div className="pointer-events-none absolute right-2 top-2 z-10 hidden translate-x-1 items-center gap-0.5 rounded-full bg-white/95 px-1 py-1 opacity-0 shadow-[0_2px_10px_rgba(0,0,0,0.08)] ring-1 ring-black/5 backdrop-blur-sm transition-all duration-200 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 lg:flex">
                <button
                  type="button"
                  onClick={(e) => onDelete(session.id, e)}
                  className="rounded-full p-1 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                  title={t("chat.deleteSession")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </button>
          </div>
        );
      })}

      {/* Sentinel for IntersectionObserver infinite scroll */}
      <div ref={sentinelRef} className="py-1">
        {isFetchingMore && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
          </div>
        )}
      </div>
    </div>
  );
}
