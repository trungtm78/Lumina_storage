import { create } from "zustand";
import { authApi } from "@/app/api/endpoints/auth";
import type { UserResponse } from "@/app/types/api";
import {
  acquireDriverApiToken,
  logoutMicrosoftRedirect,
  startDriverMicrosoftLoginRedirect,
} from "@/app/hooks/useMicrosoftToken";

export type AuthMode = "local" | "sso" | "microsoft_msal";

export const STORAGE_AUTH_MODE_KEY = "storage_auth_mode";

interface AuthState {
  accessToken: string | null;
  keycloakIdToken: string | null;
  loading: boolean;
  initialized: boolean;
  profile: UserResponse | null;
  mustChangePassword: boolean;
  authMode: AuthMode | null;

  setToken: (token: string | null) => void;
  setMustChangePassword: (value: boolean) => void;
  setKeycloakIdToken: (token: string | null) => void;
  setInitialized: (value: boolean) => void;
  setAuthMode: (mode: AuthMode | null) => void;
  fetchProfile: () => Promise<UserResponse | null>;
  setProfile: (profile: UserResponse | null) => void;
  clearAuth: () => void;
  loginMicrosoft: () => Promise<boolean>;
  loginMicrosoftSilent: () => Promise<boolean>;
  loginMicrosoftRedirect: () => Promise<void>;
  logout: () => Promise<boolean>;
  bootstrapAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  keycloakIdToken: null,
  loading: false,
  initialized: false,
  profile: null,
  mustChangePassword: false,
  authMode: null,

  setToken: (token) => set({ accessToken: token }),

  setMustChangePassword: (value) => set({ mustChangePassword: value }),

  setKeycloakIdToken: (token) => set({ keycloakIdToken: token }),

  setInitialized: (value) => set({ initialized: value }),

  setAuthMode: (mode) => {
    if (mode) {
      localStorage.setItem(STORAGE_AUTH_MODE_KEY, mode);
    } else {
      localStorage.removeItem(STORAGE_AUTH_MODE_KEY);
    }
    set({ authMode: mode });
  },

  fetchProfile: async () => {
    try {
      const profile = await authApi.me();
      set({ profile });
      return profile;
    } catch {
      set({ profile: null });
      return null;
    }
  },

  setProfile: (profile) => set({ profile }),

  clearAuth: () => {
    localStorage.removeItem(STORAGE_AUTH_MODE_KEY);
    set({
      accessToken: null,
      keycloakIdToken: null,
      profile: null,
      loading: false,
      initialized: true,
      mustChangePassword: false,
      authMode: null,
    });
  },

  loginMicrosoft: async () => {
    try {
      const token = await acquireDriverApiToken({ interactive: true });
      localStorage.setItem(STORAGE_AUTH_MODE_KEY, "microsoft_msal");
      set({ accessToken: token, authMode: "microsoft_msal" });
      const profile = await get().fetchProfile();
      if (!profile) {
        get().clearAuth();
        return false;
      }
      set({ profile, initialized: true, loading: false });
      return true;
    } catch {
      get().clearAuth();
      return false;
    }
  },

  loginMicrosoftSilent: async () => {
    try {
      const token = await acquireDriverApiToken({ interactive: false });
      localStorage.setItem(STORAGE_AUTH_MODE_KEY, "microsoft_msal");
      set({ accessToken: token, authMode: "microsoft_msal" });
      const profile = await get().fetchProfile();
      if (!profile) {
        get().clearAuth();
        return false;
      }
      set({ profile, initialized: true, loading: false });
      return true;
    } catch {
      get().clearAuth();
      return false;
    }
  },

  loginMicrosoftRedirect: async () => {
    await startDriverMicrosoftLoginRedirect();
  },

  logout: async () => {
    const sessionToken = get().accessToken;
    const authMode = get().authMode ?? (localStorage.getItem(STORAGE_AUTH_MODE_KEY) as AuthMode | null);

    // ── Microsoft coordinated logout ──────────────────────────────────────
    if (authMode === "microsoft_msal") {
      // Clear local app state before leaving; MSAL logoutPopup ends the
      // central Microsoft session and the /logout-callback page finishes local cleanup.
      get().clearAuth();
      try {
        await logoutMicrosoftRedirect(`${window.location.origin}/logout-callback`);
        // Page navigates away — nothing below runs
      } catch {
        window.location.href = "/logout-callback";
      }
      return true;
    }

    // ── SSO Keycloak logout ───────────────────────────────────────────────
    let isSSO = false;
    try {
      if (sessionToken) {
        const claims = JSON.parse(atob(sessionToken.split(".")[1]));
        isSSO = !!claims?.keycloak_sub;
      }
    } catch { /* treat as non-SSO */ }

    if (isSSO && sessionToken) {
      const SSO_URL = import.meta.env.VITE_SSO_SERVICE_URL || "http://localhost:3100";
      const postLogoutUri = `${window.location.origin}/login`;

      try {
        const urlResp = await fetch(
          `${SSO_URL}/auth/sso/logout-url?session_token=${encodeURIComponent(sessionToken)}&post_logout_redirect_uri=${encodeURIComponent(postLogoutUri)}`
        );
        const { end_session_url } = urlResp.ok
          ? (await urlResp.json() as { end_session_url: string })
          : { end_session_url: null };

        await fetch(`${SSO_URL}/auth/sso/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: sessionToken }),
        });

        get().clearAuth();
        window.location.href = end_session_url ?? postLogoutUri;
        return true;
      } catch { /* fallthrough */ }

      get().clearAuth();
      window.location.href = postLogoutUri;
      return true;
    }

    // ── Local logout ──────────────────────────────────────────────────────
    get().clearAuth();
    return false;
  },

  bootstrapAuth: async () => {
    set({ loading: true });

    const storedAuthMode = localStorage.getItem(STORAGE_AUTH_MODE_KEY) as AuthMode | null;
    const skipPaths = ["/sso", "/auth/microsoft", "/logout-callback", "/logout-bridge", "/frontchannel-logout"];
    if (skipPaths.some((p) => window.location.pathname.startsWith(p))) {
      set({ initialized: true, loading: false });
      return;
    }

    // ── 1. Restore explicit Microsoft session ─────────────────────────────
    if (storedAuthMode === "microsoft_msal") {
      try {
        const token = await acquireDriverApiToken({ interactive: false });
        set({ accessToken: token, authMode: "microsoft_msal" });
        const profile = await get().fetchProfile();
        if (profile) {
          set({ profile, initialized: true, loading: false });
          return;
        }
      } catch {
        localStorage.removeItem(STORAGE_AUTH_MODE_KEY);
      }
      get().clearAuth();
      return;
    }

    // ── 2. Fall back to refresh token cookie (local / SSO) ────────────────
    try {
      const profile = await get().fetchProfile();
      if (!profile) {
        get().clearAuth();
        return;
      }
      set({ profile, initialized: true, loading: false });
    } catch {
      get().clearAuth();
    }
  },
}));

/** Exported getter for client.ts 401 handler (avoids circular import). */
export function getStorageAuthMode(): AuthMode | null {
  return localStorage.getItem(STORAGE_AUTH_MODE_KEY) as AuthMode | null;
}

export function shouldRevokeBackendSession(authMode: AuthMode | null): boolean {
  return authMode !== "microsoft_msal";
}
