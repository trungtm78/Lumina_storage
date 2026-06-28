import { useEffect, useRef } from "react";
import {
  isMicrosoftSessionExpiredError,
  logoutMicrosoftSession,
  probeDriverMicrosoftSession,
} from "@/app/hooks/useMicrosoftToken";
import { useAuthStore } from "@/app/stores/authStore";

const CHECK_INTERVAL_MS = 60_000;
const CHECK_DEBOUNCE_MS = 250;

function shouldSkipPath(pathname: string): boolean {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/logout-callback") ||
    pathname.startsWith("/frontchannel-logout") ||
    pathname.startsWith("/auth/microsoft") ||
    pathname.startsWith("/sso")
  );
}

function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export function useCentralLogoutWatch() {
  const authMode = useAuthStore((state) => state.authMode);
  const initialized = useAuthStore((state) => state.initialized);
  // Subscribe to a boolean, NOT the raw token: each successful probe calls
  // setToken() with a fresh ssoSilent token. If the effect depended on the token
  // string it would tear down and re-probe on every refresh → infinite loop.
  const hasToken = useAuthStore((state) => !!state.accessToken);
  const scheduleRef = useRef<number | null>(null);
  const checkInFlightRef = useRef(false);
  const expiredRef = useRef(false);

  useEffect(() => {
    const enabled = initialized && authMode === "microsoft_msal" && hasToken;

    const clearScheduledCheck = () => {
      if (scheduleRef.current !== null) {
        window.clearTimeout(scheduleRef.current);
        scheduleRef.current = null;
      }
    };

    const expireSession = async () => {
      if (expiredRef.current) {
        return;
      }
      expiredRef.current = true;

      useAuthStore.getState().clearAuth();
      try {
        await logoutMicrosoftSession();
      } catch {
        // Best-effort local cache cleanup after the IdP session is already gone.
      }

      if (!shouldSkipPath(window.location.pathname)) {
        window.location.href = "/login";
      }
    };

    const runCheck = async () => {
      if (!enabled || shouldSkipPath(window.location.pathname) || !isDocumentVisible() || expiredRef.current) {
        return;
      }
      if (checkInFlightRef.current) {
        return;
      }

      checkInFlightRef.current = true;
      try {
        const token = await probeDriverMicrosoftSession();
        useAuthStore.getState().setToken(token);
      } catch (error) {
        if (isMicrosoftSessionExpiredError(error)) {
          await expireSession();
        } else {
          console.error("Central logout watch failed", error);
        }
      } finally {
        checkInFlightRef.current = false;
      }
    };

    const scheduleCheck = (delayMs = CHECK_DEBOUNCE_MS) => {
      clearScheduledCheck();
      scheduleRef.current = window.setTimeout(() => {
        scheduleRef.current = null;
        void runCheck();
      }, delayMs);
    };

    expiredRef.current = false;

    if (!enabled || shouldSkipPath(window.location.pathname)) {
      clearScheduledCheck();
      return () => {
        clearScheduledCheck();
      };
    }

    const handleFocus = () => {
      scheduleCheck(0);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleCheck(0);
      }
    };

    scheduleCheck(0);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (isDocumentVisible()) {
        scheduleCheck();
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      clearScheduledCheck();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [hasToken, authMode, initialized]);
}
