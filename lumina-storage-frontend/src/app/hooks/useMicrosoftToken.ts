import { InteractionRequiredAuthError, type AccountInfo } from '@azure/msal-browser';
import {
  clearMsalInteractionState,
  STORAGE_API_SCOPES,
  ensureMsalReady,
  MICROSOFT_POPUP_REDIRECT_URI,
  msalInstance,
} from '@/app/config/msal';
import { readMicrosoftSsoHints } from '@/app/utils/microsoftSso';

let interactiveAcquirePromise: Promise<string> | null = null;

function getMicrosoftErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'errorCode' in error) {
    const errorCode = (error as { errorCode?: unknown }).errorCode;
    return typeof errorCode === 'string' ? errorCode : undefined;
  }
  return undefined;
}

function getMicrosoftErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : '';
}

function getLogoutHint(account: AccountInfo | null | undefined): string | undefined {
  if (!account) {
    return undefined;
  }

  const idTokenClaims =
    account.idTokenClaims && typeof account.idTokenClaims === 'object'
      ? (account.idTokenClaims as Record<string, unknown>)
      : null;

  const candidates = [
    account.loginHint,
    idTokenClaims?.login_hint,
    idTokenClaims?.preferred_username,
    idTokenClaims?.upn,
    account.username,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

export function isMicrosoftInteractionRequiredError(error: unknown): boolean {
  if (error instanceof InteractionRequiredAuthError) {
    return true;
  }

  const errorCode = getMicrosoftErrorCode(error);
  const errorMessage = getMicrosoftErrorMessage(error).toLowerCase();
  return (
    errorCode === 'interaction_required' ||
    errorCode === 'login_required' ||
    errorMessage.includes('interaction_required') ||
    errorMessage.includes('login_required')
  );
}

export function isMicrosoftHardLogoutSignal(error: unknown): boolean {
  const errorCode = getMicrosoftErrorCode(error);
  const errorMessage = getMicrosoftErrorMessage(error).toLowerCase();
  return (
    errorCode === 'no_account_error' ||
    errorMessage.includes('aadsts160021') ||
    errorMessage.includes('user session which does not exist')
  );
}

export function isMicrosoftSessionExpiredError(error: unknown): boolean {
  return isMicrosoftInteractionRequiredError(error) || isMicrosoftHardLogoutSignal(error);
}

function getSilentSsoHints(): { loginHint?: string; sid?: string } {
  return readMicrosoftSsoHints(window.location.search);
}

export function clearSilentSsoHints(): void {
  const url = new URL(window.location.href);
  let changed = false;
  ['login_hint', 'sid', 'microsoft'].forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });
  if (changed) {
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
}

function getRedirectLoginRequest() {
  const { loginHint, sid } = getSilentSsoHints();
  return {
    scopes: STORAGE_API_SCOPES,
    ...(sid ? { sid } : {}),
    ...(!sid && loginHint ? { loginHint } : {}),
  };
}

export async function acquireDriverApiTokenSilentBootstrap(): Promise<string> {
  if (STORAGE_API_SCOPES.length === 0) {
    throw new Error(
      'Microsoft Entra not configured — set VITE_ENTRA_STORAGE_FE_CLIENT_ID and VITE_ENTRA_STORAGE_API_SCOPE',
    );
  }

  await ensureMsalReady();

  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  const { loginHint, sid } = getSilentSsoHints();
  const result = await msalInstance.ssoSilent({
    scopes: STORAGE_API_SCOPES,
    ...(account ? { account } : {}),
    ...(!account && sid ? { sid } : {}),
    ...(!account && loginHint ? { loginHint } : {}),
  });
  if (result.account) {
    msalInstance.setActiveAccount(result.account);
  }
  return result.accessToken;
}

export async function probeDriverMicrosoftSession(): Promise<string> {
  return acquireDriverApiTokenSilentBootstrap();
}

export async function acquireDriverApiToken(
  options: { interactive?: boolean } = {},
): Promise<string> {
  const { interactive = true } = options;
  if (STORAGE_API_SCOPES.length === 0) {
    throw new Error(
      'Microsoft Entra not configured — set VITE_ENTRA_STORAGE_FE_CLIENT_ID and VITE_ENTRA_STORAGE_API_SCOPE',
    );
  }

  await ensureMsalReady();
  try {
    const accessToken = await acquireDriverApiTokenSilentBootstrap();
    clearSilentSsoHints();
    return accessToken;
  } catch (err) {
    if (!(err instanceof InteractionRequiredAuthError)) {
      if (!interactive) {
        throw err;
      }
    } else if (!interactive) {
      throw err;
    }
  }

  if (!interactive) {
    throw new Error('Microsoft re-authentication required');
  }

  if (interactiveAcquirePromise) {
    return interactiveAcquirePromise;
  }

  interactiveAcquirePromise = (async () => {
    try {
      const { loginHint, sid } = getSilentSsoHints();
      const loginResult = await msalInstance.loginPopup({
        scopes: STORAGE_API_SCOPES,
        ...(sid ? { sid } : {}),
        ...(!sid && loginHint ? { loginHint } : {}),
      });
      if (loginResult.account) {
        msalInstance.setActiveAccount(loginResult.account);
      }

      const currentAccount = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
      if (!currentAccount) {
        throw new Error('Microsoft login completed without an account');
      }

      const result = await msalInstance.acquireTokenSilent({
        scopes: STORAGE_API_SCOPES,
        account: currentAccount,
      });
      clearSilentSsoHints();
      return result.accessToken;
    } catch (error) {
      clearMsalInteractionState();
      throw error;
    }
  })();

  try {
    return await interactiveAcquirePromise;
  } finally {
    interactiveAcquirePromise = null;
  }
}

export async function logoutMicrosoftSession(): Promise<void> {
  await ensureMsalReady();
  msalInstance.setActiveAccount(null);
  await msalInstance.clearCache();
  clearMsalInteractionState();
}

/**
 * Continue the Core -> Storage handoff when hidden-iframe SSO is unavailable.
 * This redirect runs in the Storage tab opened from Core, not in the Core app.
 */
export async function startDriverMicrosoftLoginRedirect(): Promise<void> {
  if (STORAGE_API_SCOPES.length === 0) {
    throw new Error(
      'Microsoft Entra not configured — set VITE_ENTRA_STORAGE_FE_CLIENT_ID and VITE_ENTRA_STORAGE_API_SCOPE',
    );
  }

  await ensureMsalReady();
  clearMsalInteractionState();
  await msalInstance.loginRedirect(getRedirectLoginRequest());
}

export async function logoutMicrosoftRedirect(mainWindowRedirectUri: string): Promise<void> {
  await ensureMsalReady();
  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  const logoutHint = getLogoutHint(account);
  msalInstance.setActiveAccount(null);
  await msalInstance.clearCache();
  clearMsalInteractionState();
  await msalInstance.logoutPopup({
    postLogoutRedirectUri: MICROSOFT_POPUP_REDIRECT_URI,
    mainWindowRedirectUri,
    ...(account ? { account } : {}),
    ...(logoutHint ? { logoutHint } : {}),
    popupWindowAttributes: {
      popupSize: {
        width: 520,
        height: 640,
      },
    },
  });
}
