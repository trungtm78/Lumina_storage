import {
  User,
  LogOut,
  Menu,
  Settings,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { authApi } from "@/app/api/endpoints/auth";
import { LanguageSelector } from "@/app/components/LanguageSelector";
import {
  getStorageAuthMode,
  shouldRevokeBackendSession,
  useAuthStore,
} from "@/app/stores/authStore";
import { useAppTitle } from "@/app/contexts/BrandingContext";

interface HeaderProps {
  onLogout?: () => void;
  onMenuClick?: () => void;
  onSettingsClick?: () => void;
  onProfileClick?: () => void;
  isSidebarExpanded?: boolean;
}

export function Header({
  onLogout,
  onMenuClick,
  onSettingsClick,
  onProfileClick,
  isSidebarExpanded = false,
}: HeaderProps) {
  const { t } = useTranslation();
  const appTitle = useAppTitle();
  const [showDropdown, setShowDropdown] = useState(false);
  const profile = useAuthStore((s) => s.profile);
  const displayName = profile?.full_name || profile?.username || "User";
  const roleLabel = profile?.role?.name;
  const greeting = t("common.helloWithName", { name: displayName });
  const initial =
    profile?.full_name?.[0]?.toUpperCase() ??
    profile?.username?.[0]?.toUpperCase() ??
    "?";
  const [loggingOut, setLoggingOut] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showDropdown]);

  const handleLogout = async () => {
    setShowDropdown(false);
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
      const redirected = await useAuthStore.getState().logout(); // SSO: revokes + redirects; non-SSO: returns false
      if (!redirected) {
        onLogout?.();
      }
      setLoggingOut(false);
    }
  };


  return (
    <div className="flex h-14 items-center justify-between gap-3 border-b border-border bg-card px-3 sm:px-4 md:px-6">
      {/* Left */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {/* Text Logo - only visible on desktop when sidebar is collapsed */}
        {!isSidebarExpanded && (
          <div className="hidden truncate text-base font-bold text-accent-foreground md:block">
            {appTitle}
          </div>
        )}

        <button
          type="button"
          onClick={onMenuClick}
          className="hover:bg-brand-50 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-700 transition-colors md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex min-w-0 items-center gap-2 md:hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden">
            <img
              src="/lumina-logo.png"
              alt="Lumina"
              className="h-8 w-8 object-contain"
            />
          </div>
          <div className="hidden text-base font-bold text-accent-foreground sm:block">
            {appTitle}
          </div>
        </div>
      </div>

      {/* Right side */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {profile && (
          <div className="bg-brand-500/10 border-brand-500/30 hidden items-center gap-3 rounded-lg border px-3 py-2 md:flex">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {greeting}
              </p>
            </div>
            {roleLabel && (
              <span className="bg-brand-500 text-white rounded-full px-2 py-0.5 text-[10px] font-semibold">
                {roleLabel}
              </span>
            )}
          </div>
        )}

        <LanguageSelector className="h-8" />

        <div className="relative ml-1 sm:ml-2" ref={dropdownRef}>
          <button
            className="bg-brand-500 hover:bg-brand-600 flex h-8 w-8 items-center justify-center rounded-full text-white shadow-sm transition-colors"
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <span className="text-sm font-medium">{initial}</span>
          </button>

          {showDropdown && (
            <div className="absolute top-12 right-0 z-50 w-52 rounded-lg border border-border bg-card shadow-lg">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">
                  {displayName}
                </p>
              </div>
              <button
                className="flex w-full items-center border-b border-border px-4 py-3 text-left text-gray-700 transition-colors hover:bg-muted"
                onClick={() => {
                  setShowDropdown(false);
                  onProfileClick?.();
                }}
              >
                <User className="mr-3 h-4 w-4 text-gray-500" />
                <span className="text-sm">{t("header.myProfile")}</span>
              </button>

              <button
                className="flex w-full items-center border-b border-border px-4 py-3 text-left text-gray-700 transition-colors hover:bg-muted"
                onClick={() => {
                  setShowDropdown(false);
                  onSettingsClick?.();
                }}
              >
                <Settings className="mr-3 h-4 w-4 text-gray-500" />
                <span className="text-sm">{t("header.settings")}</span>
              </button>

              <button
                className="text-brand-600 hover:bg-brand-50 flex w-full items-center rounded-b-lg px-4 py-3 text-left transition-colors disabled:opacity-50"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                <LogOut className="mr-3 h-4 w-4" />
                <span className="text-sm font-medium">
                  {loggingOut ? t("common.loggingOut") : t("common.logout")}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
