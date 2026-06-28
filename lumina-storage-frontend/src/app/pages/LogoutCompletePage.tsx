import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { logoutMicrosoftSession } from "@/app/hooks/useMicrosoftToken";
import { useAuthStore } from "@/app/stores/authStore";

const CORE_ORIGIN = (import.meta.env.VITE_CORE_ORIGIN as string)?.trim() || "";
const LOGOUT_BRIDGE_MESSAGE_TYPE = "lumina:logout-bridge";
const LOGOUT_BRIDGE_TIMEOUT_MS = 5000;

/**
 * Landing page after Microsoft logoutRedirect returns from Azure.
 * Clears any local Storage app state and MSAL cache, then returns to /login.
 */
export function LogoutCompletePage() {
  const navigate = useNavigate();
  const ranRef = useRef(false);
  const bridgeIdRef = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `bridge-${Date.now()}`,
  );
  const [bridgeActive, setBridgeActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEmbedded = typeof window !== "undefined" && window.parent !== window;

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let canceled = false;

    const waitForCoreBridge = () => {
      if (!CORE_ORIGIN || isEmbedded) return Promise.resolve();
      setBridgeActive(true);

      return new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          window.removeEventListener("message", handleMessage);
          reject(new Error("Core logout bridge timed out."));
        }, LOGOUT_BRIDGE_TIMEOUT_MS);

        const handleMessage = (event: MessageEvent) => {
          if (event.origin !== new URL(CORE_ORIGIN).origin) return;
          const payload = event.data as {
            type?: string;
            bridgeId?: string;
            status?: "ok" | "error";
            error?: string;
          } | undefined;
          if (
            payload?.type !== LOGOUT_BRIDGE_MESSAGE_TYPE ||
            payload.bridgeId !== bridgeIdRef.current
          ) return;

          window.clearTimeout(timeoutId);
          window.removeEventListener("message", handleMessage);
          if (payload.status === "ok") resolve();
          else reject(new Error(payload.error || "Core logout bridge failed."));
        };

        window.addEventListener("message", handleMessage);
      });
    };

    void (async () => {
      useAuthStore.getState().clearAuth();
      await logoutMicrosoftSession();
      await waitForCoreBridge();

      if (!canceled && !isEmbedded) {
        navigate("/login", { replace: true });
      }
    })().catch((err: unknown) => {
      if (!canceled) {
        const message = err instanceof Error ? err.message : "Microsoft logout cleanup failed.";
        setError(message);
        // Front-channel logout may be loaded in a hidden iframe. Only redirect
        // the top-level app; the iframe variant should quietly clear local state.
        if (!isEmbedded) {
          window.setTimeout(() => {
            if (!canceled) navigate("/login", { replace: true });
          }, 3000);
        }
      }
    });

    return () => { canceled = true; };
  }, [isEmbedded, navigate]);

  if (isEmbedded) {
    return null;
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-4 text-sm text-gray-500">
        <span>{error ?? "Signing out…"}</span>
        {CORE_ORIGIN && bridgeActive && (
          <iframe
            src={`${CORE_ORIGIN}/logout-bridge?bridgeId=${encodeURIComponent(bridgeIdRef.current)}&parentOrigin=${encodeURIComponent(window.location.origin)}`}
            className="hidden"
            aria-hidden="true"
            title="core-logout-bridge"
          />
        )}
      </div>
    </div>
  );
}
