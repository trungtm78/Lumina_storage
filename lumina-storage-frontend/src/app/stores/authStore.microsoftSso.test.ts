import { beforeEach, describe, expect, it, vi } from "vitest";

const { acquireDriverApiTokenMock, authMeMock, startDriverMicrosoftLoginRedirectMock } = vi.hoisted(() => ({
  acquireDriverApiTokenMock: vi.fn(),
  authMeMock: vi.fn(),
  startDriverMicrosoftLoginRedirectMock: vi.fn(),
}));

vi.mock("@/app/hooks/useMicrosoftToken", () => ({
  acquireDriverApiToken: acquireDriverApiTokenMock,
  logoutMicrosoftRedirect: vi.fn(),
  logoutMicrosoftSession: vi.fn(),
  startDriverMicrosoftLoginRedirect: startDriverMicrosoftLoginRedirectMock,
}));

vi.mock("@/app/api/endpoints/auth", () => ({
  authApi: { me: authMeMock },
}));

import {
  shouldRevokeBackendSession,
  STORAGE_AUTH_MODE_KEY,
  useAuthStore,
} from "@/app/stores/authStore";

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

describe("authStore Microsoft SSO handoff", () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
  });

  it("establishes the Drive session without interactive authentication", async () => {
    const profile = { id: "user-1", username: "user@example.com" };
    acquireDriverApiTokenMock.mockResolvedValue("microsoft-access-token");
    authMeMock.mockResolvedValue(profile);

    await expect(useAuthStore.getState().loginMicrosoftSilent()).resolves.toBe(true);

    expect(acquireDriverApiTokenMock).toHaveBeenCalledWith({ interactive: false });
    expect(localStorage.getItem(STORAGE_AUTH_MODE_KEY)).toBe("microsoft_msal");
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: "microsoft-access-token",
      authMode: "microsoft_msal",
      profile,
      initialized: true,
    });
  });

  it("returns false when Microsoft requires an interactive fallback", async () => {
    acquireDriverApiTokenMock.mockRejectedValue(new Error("interaction_required"));

    await expect(useAuthStore.getState().loginMicrosoftSilent()).resolves.toBe(false);

    expect(localStorage.getItem(STORAGE_AUTH_MODE_KEY)).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      authMode: null,
      profile: null,
    });
  });

  it("delegates the Core handoff redirect fallback to MSAL", async () => {
    startDriverMicrosoftLoginRedirectMock.mockResolvedValue(undefined);

    await expect(useAuthStore.getState().loginMicrosoftRedirect()).resolves.toBeUndefined();

    expect(startDriverMicrosoftLoginRedirectMock).toHaveBeenCalledOnce();
  });
});

describe("backend session revocation", () => {
  it("does not call local backend logout for Microsoft sessions", () => {
    expect(shouldRevokeBackendSession("microsoft_msal")).toBe(false);
    expect(shouldRevokeBackendSession("local")).toBe(true);
    expect(shouldRevokeBackendSession("sso")).toBe(true);
  });
});
