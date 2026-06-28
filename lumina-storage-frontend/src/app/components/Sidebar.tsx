import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  Star,
  Trash2,
  MessageSquare,
  FileCheck,
  FileEdit,
  FileSearch,
  Users,
  UserCheck,
  X,
  Settings,
  ClipboardList,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { authApi } from "@/app/api/endpoints/auth";
import {
  getStorageAuthMode,
  shouldRevokeBackendSession,
  useAuthStore,
} from "@/app/stores/authStore";
import { useBranding, useAppTitle } from "@/app/contexts/BrandingContext";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/app/components/ui/tooltip";

const ICON_MAP: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/documents": FolderOpen,
  "/chat": MessageSquare,
  "/templates": FileCheck,
  "/generator": FileEdit,
  "/review": FileSearch,
  "/users-roles": Users,
  "/candidate-evaluation": UserCheck,
  "/starred": Star,
  "/trash": Trash2,
  "/tasks": ClipboardList,
  "/settings": Settings,
};

const DEFAULT_ICON: LucideIcon = FolderOpen;

interface MenuItem {
  id: string;
  icon: LucideIcon;
  label: string;
  urlpath: string;
  level: number;
}

interface SidebarProps {
  activeItem?: string;
  onMenuItemClick?: (itemId: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  onLogout?: () => void;
}

export function Sidebar({
  activeItem = "my-drive",
  onMenuItemClick,
  isOpen = false,
  onClose,
  onExpandedChange,
  onLogout,
}: SidebarProps) {
  const { t } = useTranslation();
  const [loggingOut, setLoggingOut] = useState(false);
  const profile = useAuthStore((s) => s.profile);
  const { settings } = useBranding();
  const appTitle = useAppTitle();
  const logoSrc = settings?.logo_url || "/lumina-logo.png";

  const [isCollapsed, setIsCollapsed] = useState(false);
  const isExpanded = !isCollapsed;

  useEffect(() => {
    onExpandedChange?.(isExpanded);
  }, [isExpanded, onExpandedChange]);

  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  const menuItems: MenuItem[] = useMemo(() => {
    let items: MenuItem[] = [];

    if (profile?.role?.is_default) {
      items = [
        { id: "dashboard",           icon: LayoutDashboard, label: t("nav.dashboard"),         urlpath: "/dashboard",           level: 2 },
        { id: "documents",           icon: FolderOpen,    label: t("nav.documents"),          urlpath: "/documents",           level: 2 },
        { id: "chat",                icon: MessageSquare, label: t("nav.chatAI"),              urlpath: "/chat",                level: 2 },
        { id: "generator",           icon: FileEdit,      label: t("nav.generator"),           urlpath: "/generator",           level: 2 },
        { id: "review",              icon: FileSearch,    label: t("nav.documentReview"),      urlpath: "/review",              level: 2 },
        { id: "trash",               icon: Trash2,        label: t("nav.trash"),               urlpath: "/trash",               level: 2 },
        { id: "settings",            icon: Settings,      label: t("nav.settings"),            urlpath: "/settings",            level: 2 },
        { id: "users-roles",         icon: Users,         label: t("nav.usersGroupsRoles"),    urlpath: "/users-roles",         level: 2 },
        { id: "starred",             icon: Star,          label: t("nav.starred"),             urlpath: "/starred",             level: 2 },
        { id: "tasks",               icon: ClipboardList, label: t("nav.taskLogs"),            urlpath: "/tasks",               level: 2 },
      ];
    } else {
      const permissions = profile?.role?.permissions ?? [];
      items = permissions
        .filter((p) => p.level > 0 || p.urlpath === "/documents")
        .filter((p) => p.urlpath !== "/ops-excel")
        .filter((p) => p.urlpath !== "/templates")
        .map((p) => ({
          id: p.urlpath.replace(/^\//, ""),
          icon: ICON_MAP[p.urlpath] ?? DEFAULT_ICON,
          label: p.name,
          urlpath: p.urlpath,
          level: p.level,
        }));
    }

    if (!items.some((item) => item.urlpath === "/documents")) {
      items.unshift({ id: "documents", icon: FolderOpen, label: t("nav.documents"), urlpath: "/documents", level: 0 });
    }
    if (!items.some((item) => item.urlpath === "/generator")) {
      const chatIdx = items.findIndex((item) => item.urlpath === "/chat");
      items.splice(chatIdx >= 0 ? chatIdx + 1 : items.length, 0, { id: "generator", icon: FileEdit, label: t("nav.generator"), urlpath: "/generator", level: 0 });
    }
    if (!items.some((item) => item.urlpath === "/review")) {
      const generatorIdx = items.findIndex((item) => item.urlpath === "/generator");
      items.splice(generatorIdx >= 0 ? generatorIdx + 1 : items.length, 0, { id: "review", icon: FileSearch, label: t("nav.documentReview"), urlpath: "/review", level: 0 });
    }
    if (!items.some((item) => item.urlpath === "/candidate-evaluation")) {
      items.push({ id: "candidate-evaluation", icon: UserCheck, label: t("nav.candidateEvaluation"), urlpath: "/candidate-evaluation", level: 0 });
    }

    return items;
  }, [profile, t]);

  const handleLogout = async () => {
    setLoggingOut(true);
    const authMode = getStorageAuthMode();
    try {
      if (shouldRevokeBackendSession(authMode)) {
        await authApi.logout();
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || t("common.logoutFailed");
      toast.error(message);
    } finally {
      const redirected = await useAuthStore.getState().logout();
      if (!redirected) {
        onLogout?.();
      }
      setLoggingOut(false);
    }
  };

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────── */}
      <div className="relative hidden md:block">
        <div
          className={`relative z-20 flex h-screen flex-col border-r border-brand-50 bg-sidebar transition-all duration-200 ease-out ${
            isExpanded ? "w-60" : "w-[60px]"
          }`}
        >
          {/* Logo */}
          <div
            className={`flex items-center border-b border-brand-50 px-4 py-4 ${
              isExpanded ? "gap-2.5" : "justify-center"
            }`}
          >
            <img
              src={logoSrc}
              alt={appTitle}
              className="h-9 w-9 flex-shrink-0 object-contain"
            />
            {isExpanded && (
              <span className="truncate whitespace-nowrap text-base font-bold text-accent-foreground">
                {appTitle}
              </span>
            )}
          </div>

          {/* Collapse toggle */}
          {isExpanded ? (
            <div className="px-3 pb-2">
              <button
                type="button"
                onClick={handleToggleCollapse}
                aria-label="Collapse"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PanelLeftClose className="h-5 w-5 flex-shrink-0" />
                <span>{t("sidebar.collapse")}</span>
              </button>
            </div>
          ) : (
            <div className="flex justify-center pb-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleToggleCollapse}
                    aria-label="Expand"
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <PanelLeftOpen className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t("sidebar.expand")}</TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-2 pb-2">
            <ul className="space-y-0.5">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === activeItem;

                const navBtn = (
                  <button
                    onClick={(e) => { e.stopPropagation(); onMenuItemClick?.(item.id); }}
                    className={`flex w-full items-center text-left rounded-lg transition-all ${
                      isExpanded ? "gap-3 px-3 py-2.5" : "justify-center p-2.5"
                    } ${
                      isActive
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    {isExpanded && <span className="text-sm">{item.label}</span>}
                  </button>
                );

                return (
                  <li key={item.id}>
                    {!isExpanded ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{navBtn}</TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    ) : navBtn}
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Logout */}
          <div className="border-t border-brand-50 p-2">
            {!isExpanded ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleLogout(); }}
                    disabled={loggingOut}
                    className="flex w-full justify-center rounded-lg p-2.5 text-accent-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t("common.logout")}</TooltipContent>
              </Tooltip>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); handleLogout(); }}
                disabled={loggingOut}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <LogOut className="h-5 w-5 flex-shrink-0" />
                <span>{loggingOut ? t("common.loggingOut") : t("common.logout")}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile sidebar ──────────────────────────────────────── */}
      <div
        className={`fixed inset-y-0 left-0 z-40 flex w-2/3 max-w-[280px] transform flex-col border-r border-brand-50 bg-sidebar transition-transform duration-200 ease-out md:hidden ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo + close */}
        <div className="flex items-center justify-between gap-3 border-b border-brand-50 px-4 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <img
              src={logoSrc}
              alt={appTitle}
              className="h-9 w-9 flex-shrink-0 object-contain"
            />
            <span className="truncate text-base font-bold text-accent-foreground">{appTitle}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          <ul className="space-y-0.5">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeItem;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => { onMenuItemClick?.(item.id); }}
                    className={`flex w-full items-center text-left gap-3 rounded-lg px-3 py-2.5 transition-all ${
                      isActive
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <span className="text-sm">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Logout */}
        <div className="border-t border-brand-50 p-2">
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            <span>{loggingOut ? t("common.loggingOut") : t("common.logout")}</span>
          </button>
        </div>
      </div>
    </>
  );
}
