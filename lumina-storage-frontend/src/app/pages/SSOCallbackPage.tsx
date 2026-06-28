import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { authApi } from "@/app/api/endpoints/auth";
import { useAuthStore } from "@/app/stores/authStore";

export function SSOCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setToken = useAuthStore((s) => s.setToken);
  const setKeycloakIdToken = useAuthStore((s) => s.setKeycloakIdToken);
  const fetchProfile = useAuthStore((s) => s.fetchProfile);
  const setAuthMode = useAuthStore((s) => s.setAuthMode);

  useEffect(() => {
    // prompt=none flow: no active Keycloak session → go to local login page.
    if (searchParams.get("sso_error") === "login_required") {
      navigate("/login", { replace: true });
      return;
    }

    const ssoCode = searchParams.get("sso_code");

    if (!ssoCode) {
      navigate("/login", { replace: true });
      return;
    }

    authApi
      .ssoExchange({ sso_code: ssoCode })
      .then(async (data) => {
        setAuthMode("sso");
        setToken(data.access_token);
        if (data.keycloak_id_token) {
          setKeycloakIdToken(data.keycloak_id_token);
        }
        await fetchProfile();
        const redirectTo = sessionStorage.getItem("sso_post_login_redirect") || "/";
        sessionStorage.removeItem("sso_post_login_redirect");
        navigate(redirectTo, { replace: true });
      })
      .catch(() => {
        toast.error("Đăng nhập SSO thất bại. Vui lòng thử lại.");
        navigate("/login", { replace: true });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-6">
        <div className="text-3xl font-semibold text-brand-400">Lumina Storage</div>
        <div className="h-8 w-8 rounded-full border-4 border-brand-400 border-t-transparent animate-spin" />
        <p className="text-sm text-gray-500">Đang hoàn tất đăng nhập...</p>
      </div>
    </div>
  );
}
