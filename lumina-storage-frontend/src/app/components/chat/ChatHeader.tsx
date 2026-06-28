import { Maximize2, Minimize2, PanelLeftClose, FileText, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ChatHeaderProps {
  title: string | null;
  isMaximized: boolean;
  isCreating: boolean;
  onToggleMaximize: () => void;
  onOpenSidebar: () => void;
  onNewSession: () => void;
}

export function ChatHeader({
  title,
  isMaximized,
  isCreating,
  onToggleMaximize,
  onOpenSidebar,
  onNewSession,
}: ChatHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-[rgba(0,0,0,0.08)] bg-white px-3 sm:px-5">
      {/* Left */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="bg-brand-500 flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm sm:h-10 sm:w-10">
          <FileText className="h-3.5 w-3.5 text-white sm:h-4 sm:w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold leading-none text-[#1f1f1f]">
            {title ?? t("chat.multiDoc")}
          </h2>
          <p className="mt-1 truncate text-[11px] leading-none text-[#777] sm:text-[12px]">
            {t("chat.multiDocSubtitle")}
          </p>
        </div>
      </div>

      {/* Right */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          onClick={onToggleMaximize}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(0,0,0,0.10)] bg-white text-[#777] shadow-[0_1px_1px_rgba(0,0,0,0.02)] transition-colors hover:bg-[#fcfcfc] sm:h-9 sm:w-9"
          title={isMaximized ? t("chat.minimize") : t("chat.expand")}
        >
          {isMaximized ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={onNewSession}
          disabled={isCreating}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(0,0,0,0.10)] bg-white text-[#777] shadow-[0_1px_1px_rgba(0,0,0,0.02)] transition-colors hover:bg-[#fcfcfc] disabled:opacity-50 sm:h-9 sm:w-9"
          title={t("chat.newSession")}
        >
          <Plus className="h-4 w-4" />
        </button>
        {!isMaximized && (
          <button
            onClick={onOpenSidebar}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(0,0,0,0.10)] bg-white text-[#777] shadow-[0_1px_1px_rgba(0,0,0,0.02)] transition-colors hover:bg-[#fcfcfc] sm:h-9 sm:w-9 lg:hidden"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
