import { useEffect } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/app/stores/authStore";

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const bootstrapAuth = useAuthStore((s) => s.bootstrapAuth);
  const setInitialized = useAuthStore((s) => s.setInitialized);
  const initialized = useAuthStore((s) => s.initialized);
  const loading = useAuthStore((s) => s.loading);
  const location = useLocation();
  const profile = useAuthStore((s) => s.profile);
  const { i18n, t } = useTranslation();
  const isMicrosoftHandoff =
    new URLSearchParams(location.search).get("microsoft") === "1";

  useEffect(() => {
    // Skip bootstrap on auth callback and logout pages — those handlers own the flow.
    if (
      location.pathname.startsWith("/sso") ||
      location.pathname.startsWith("/auth/microsoft") ||
      location.pathname.startsWith("/logout-callback") ||
      location.pathname.startsWith("/logout-bridge") ||
      location.pathname.startsWith("/frontchannel-logout")
    ) {
      setInitialized(true);
      return;
    }
    // Bootstrap once to restore session from refresh token cookie (local login)
    if (!initialized) {
      void bootstrapAuth();
    }
  }, [bootstrapAuth, initialized, location.pathname, setInitialized]);

  useEffect(() => {
    if (profile?.locale) {
      localStorage.setItem("lumina_locale", profile.locale);
      void i18n.changeLanguage(profile.locale);
    }
  }, [profile?.locale, i18n]);

  if (!initialized || loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-6">
          <div className="text-brand-400 text-3xl font-semibold">
            Lumina Storage
          </div>
          <div className="border-brand-400 h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
          {isMicrosoftHandoff && (
            <p className="text-sm text-gray-500">
              {t("login.signingIn", "Đang đăng nhập với Microsoft...")}
            </p>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
