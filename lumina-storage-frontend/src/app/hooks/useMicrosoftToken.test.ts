import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureMsalReadyMock,
  clearMsalInteractionStateMock,
  ssoSilentMock,
  acquireTokenSilentMock,
  getActiveAccountMock,
  getAllAccountsMock,
  setActiveAccountMock,
  loginRedirectMock,
  clearCacheMock,
  logoutPopupMock,
} = vi.hoisted(() => ({
  ensureMsalReadyMock: vi.fn(),
  clearMsalInteractionStateMock: vi.fn(),
  ssoSilentMock: vi.fn(),
  acquireTokenSilentMock: vi.fn(),
  getActiveAccountMock: vi.fn(),
  getAllAccountsMock: vi.fn(),
  setActiveAccountMock: vi.fn(),
  loginRedirectMock: vi.fn(),
  clearCacheMock: vi.fn(),
  logoutPopupMock: vi.fn(),
}));

vi.mock("@/app/config/msal", () => ({
  STORAGE_API_SCOPES: ["api://storage-scope/Storage.Access"],
  clearMsalInteractionState: clearMsalInteractionStateMock,
  ensureMsalReady: ensureMsalReadyMock,
  MICROSOFT_POPUP_REDIRECT_URI: "http://localhost:5174/auth/microsoft/popup",
  msalInstance: {
    ssoSilent: ssoSilentMock,
    acquireTokenSilent: acquireTokenSilentMock,
    getActiveAccount: getActiveAccountMock,
    getAllAccounts: getAllAccountsMock,
    setActiveAccount: setActiveAccountMock,
    loginRedirect: loginRedirectMock,
    clearCache: clearCacheMock,
    logoutPopup: logoutPopupMock,
  },
}));

import {
  acquireDriverApiToken,
  isMicrosoftHardLogoutSignal,
  probeDriverMicrosoftSession,
  startDriverMicrosoftLoginRedirect,
  logoutMicrosoftRedirect,
} from "./useMicrosoftToken";

function installBrowserStubs() {
  const storage = {
    length: 0,
    key: vi.fn(() => null),
    removeItem: vi.fn(),
  };

  vi.stubGlobal("window", {
    location: {
      search: "",
      href: "http://localhost:5174/",
      pathname: "/",
      hash: "",
    },
    history: {
      replaceState: vi.fn(),
    },
    localStorage: storage,
    sessionStorage: storage,
  });

  vi.stubGlobal("document", {
    title: "Lumina Storage",
    visibilityState: "visible",
  });
}

describe("useMicrosoftToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureMsalReadyMock.mockResolvedValue(undefined);
    clearCacheMock.mockResolvedValue(undefined);
    logoutPopupMock.mockResolvedValue(undefined);
    getActiveAccountMock.mockReturnValue(null);
    getAllAccountsMock.mockReturnValue([]);
    installBrowserStubs();
  });

  it("does not treat plain interaction-required errors as a hard logout", () => {
    expect(isMicrosoftHardLogoutSignal(new InteractionRequiredAuthError("login_required"))).toBe(
      false,
    );
    expect(
      isMicrosoftHardLogoutSignal(
        new Error(
          "AADSTS160021: Application requested a user session which does not exist.",
        ),
      ),
    ).toBe(true);
  });

  it("treats silent runtime interaction-required as an expired session signal", async () => {
    ssoSilentMock.mockRejectedValue(new InteractionRequiredAuthError("login_required"));

    await expect(probeDriverMicrosoftSession()).rejects.toBeInstanceOf(InteractionRequiredAuthError);
  });

  it("requires re-authentication for non-interactive login when silent bootstrap fails", async () => {
    const account = { username: "user@example.com" };
    ssoSilentMock.mockRejectedValue(new InteractionRequiredAuthError("login_required"));
    getAllAccountsMock.mockReturnValue([account]);
    acquireTokenSilentMock.mockResolvedValue({ accessToken: "cached-driver-token" });

    await expect(acquireDriverApiToken({ interactive: false })).rejects.toBeInstanceOf(
      InteractionRequiredAuthError,
    );
  });

  it("preserves Core SSO hints in the redirect fallback", async () => {
    window.location.search = "?microsoft=1&login_hint=user%40example.com&sid=session-123";
    loginRedirectMock.mockResolvedValue(undefined);

    await startDriverMicrosoftLoginRedirect();

    expect(loginRedirectMock).toHaveBeenCalledWith({
      scopes: ["api://storage-scope/Storage.Access"],
      sid: "session-123",
    });
  });

  it("clears every local account and completes logout through the popup bridge", async () => {
    const account = { username: "user@example.com" };
    getActiveAccountMock.mockReturnValue(account);

    await logoutMicrosoftRedirect("http://localhost:5174/logout-callback");

    expect(setActiveAccountMock).toHaveBeenCalledWith(null);
    expect(clearCacheMock).toHaveBeenCalledOnce();
    expect(clearCacheMock.mock.invocationCallOrder[0]).toBeLessThan(
      logoutPopupMock.mock.invocationCallOrder[0],
    );
    expect(logoutPopupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        postLogoutRedirectUri: "http://localhost:5174/auth/microsoft/popup",
        mainWindowRedirectUri: "http://localhost:5174/logout-callback",
      }),
    );
  });

});
