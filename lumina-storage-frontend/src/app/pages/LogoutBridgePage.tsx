import { useEffect, useRef } from "react";
import { logoutMicrosoftSession } from "@/app/hooks/useMicrosoftToken";
import { useAuthStore } from "@/app/stores/authStore";

const LOGOUT_BRIDGE_MESSAGE_TYPE = "lumina:logout-bridge";

/** Clear Storage auth when Core initiates global Microsoft logout. */
export function LogoutBridgePage() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const bridgeId = params.get("bridgeId") || undefined;
      const parentOrigin = params.get("parentOrigin") || window.location.origin;

      try {
        useAuthStore.getState().clearAuth();
        await logoutMicrosoftSession();
        window.parent.postMessage(
          { type: LOGOUT_BRIDGE_MESSAGE_TYPE, bridgeId, status: "ok" },
          parentOrigin,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Storage logout bridge failed.";
        window.parent.postMessage(
          { type: LOGOUT_BRIDGE_MESSAGE_TYPE, bridgeId, status: "error", error: message },
          parentOrigin,
        );
      }
    })();
  }, []);

  return null;
}
