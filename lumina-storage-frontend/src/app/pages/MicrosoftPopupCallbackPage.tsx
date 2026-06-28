import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";
import {
  acquireDriverApiToken,
  clearSilentSsoHints,
  isMicrosoftSessionExpiredError,
} from "@/app/hooks/useMicrosoftToken";
import { ensureMsalReady } from "@/app/config/msal";
import { STORAGE_AUTH_MODE_KEY, useAuthStore } from "@/app/stores/authStore";
import { shouldBridgeMicrosoftResponse } from "@/app/utils/microsoftSso";

export function MicrosoftPopupCallbackPage() {
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const setAuthMode = useAuthStore((s) => s.setAuthMode);
  const fetchProfile = useAuthStore((s) => s.fetchProfile);
  const setInitialized = useAuthStore((s) => s.setInitialized);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // MSAL v5 uses this redirect URI in both popup windows and hidden iframes
    // created by ssoSilent(). Both must relay the response to the main frame.
    const isBridgeFlow = shouldBridgeMicrosoftResponse({
      hasOpener: !!window.opener && window.opener !== window,
      embedded: window.parent !== window,
    });

    if (isBridgeFlow) {
      void broadcastResponseToMainFrame().catch((err) => {
        if (isMicrosoftSessionExpiredError(err)) {
          window.close();
          return;
        }
        const message =
          err instanceof Error ? err.message : "Microsoft sign-in callback failed";
        setError(message);
      });
      return;
    }

    void ensureMsalReady()
      .then(async () => {
        const accessToken = await acquireDriverApiToken({ interactive: false });
        localStorage.setItem(STORAGE_AUTH_MODE_KEY, "microsoft_msal");
        setToken(accessToken);
        setAuthMode("microsoft_msal");
        const profile = await fetchProfile();
        if (!profile) {
          throw new Error("Microsoft sign-in completed but Storage profile could not be loaded");
        }
        clearSilentSsoHints();
        setInitialized(true);
        navigate("/", { replace: true });
      })
      .catch((err) => {
        if (isMicrosoftSessionExpiredError(err)) {
          useAuthStore.getState().clearAuth();
          navigate("/login", { replace: true });
          return;
        }
        const message =
          err instanceof Error ? err.message : "Microsoft sign-in callback failed";
        setError(message);
      });
  }, [fetchProfile, navigate, setAuthMode, setInitialized, setToken]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-sm text-gray-500">
      {error ?? "Completing Microsoft sign-in…"}
    </div>
  );
}
