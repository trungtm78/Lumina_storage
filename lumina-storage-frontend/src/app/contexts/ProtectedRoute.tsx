import { Navigate, useLocation } from "react-router";
import { useEffect, useRef } from "react";
import { useAuthStore } from "@/app/stores/authStore";
import { buildMicrosoftLoginSearch } from "@/app/utils/microsoftSso";

const SSO_URL = import.meta.env.VITE_SSO_SERVICE_URL?.trim() || "";
const SSO_AUTO_REDIRECT = import.meta.env.VITE_SSO_AUTO_REDIRECT === "true";
const SSO_APP = import.meta.env.VITE_SSO_APP?.trim() || "storage";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);
  const location = useLocation();
  const prevTokenRef = useRef<string | null>(accessToken);

  useEffect(() => {
    if (!accessToken) {
      const hadToken = prevTokenRef.current !== null;
      const wantsMicrosoft = new URLSearchParams(location.search).get("microsoft") === "1";

      if (wantsMicrosoft) {
        // Preserve the SSO hints from Core so /login → loginRedirect can sign in
        // silently. Dropping login_hint/sid here is what forces the account picker.
        window.location.href = `/login?${buildMicrosoftLoginSearch(location.search)}`;
        return;
      }

      if (hadToken || !SSO_URL || !SSO_AUTO_REDIRECT) {
        window.location.href = "/login";
      } else {
        const destination = location.pathname + location.search;
        if (destination !== "/" && !destination.startsWith("/sso")) {
          sessionStorage.setItem("sso_post_login_redirect", destination);
        }
        const params = new URLSearchParams({
          redirect_uri: `${window.location.origin}/sso/callback`,
          app: SSO_APP,
          prompt: "none",
        });
        window.location.href = `${SSO_URL}/auth/sso/login?${params}`;
      }
    }

    prevTokenRef.current = accessToken;
  }, [accessToken, location]);

  if (!accessToken) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-6">
          <div className="text-3xl font-semibold text-brand-400">Lumina Storage</div>
          <div className="h-8 w-8 rounded-full border-4 border-brand-400 border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  if (mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
}
