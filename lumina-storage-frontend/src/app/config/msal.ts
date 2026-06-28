/**
 * MSAL configuration for Lumina Storage (Driver) API.
 *
 * The frontend acquires a Microsoft access token scoped to the Storage API
 * (VITE_ENTRA_STORAGE_API_SCOPE) and sends it as the Bearer header for all
 * API calls when auth mode is 'microsoft_msal'.
 *
 * Required env vars (add to .env):
 *   VITE_ENTRA_TENANT_ID              Azure tenant ID
 *   VITE_ENTRA_STORAGE_FE_CLIENT_ID   Storage Frontend SPA app registration client ID
 *   VITE_ENTRA_STORAGE_API_SCOPE      e.g. api://<storage-api-client-id>/Storage.Access
 *   VITE_ENTRA_REDIRECT_URI           e.g. http://localhost:5174/auth/microsoft/popup
 */
import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

export const MICROSOFT_POPUP_REDIRECT_URI =
  import.meta.env.VITE_ENTRA_REDIRECT_URI ??
  `${window.location.origin}/auth/microsoft/popup`;

const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_ENTRA_STORAGE_FE_CLIENT_ID ?? '',
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID ?? 'common'}`,
    redirectUri: MICROSOFT_POPUP_REDIRECT_URI,
    postLogoutRedirectUri: MICROSOFT_POPUP_REDIRECT_URI,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
  system: {
    allowRedirectInIframe: true,
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

let msalReadyPromise: Promise<void> | null = null;

const MSAL_CACHE_PREFIX = 'msal.';
const MSAL_INTERACTION_STATUS_KEY = 'msal.interaction.status';
const MSAL_TEMP_KEY_SUFFIXES = [
  '.request.params',
  '.code.verifier',
  '.request.origin',
  '.urlHash',
  '.request.native',
];

function getMsalErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'errorCode' in error) {
    const errorCode = (error as { errorCode?: unknown }).errorCode;
    return typeof errorCode === 'string' ? errorCode : undefined;
  }
  return undefined;
}

function isRecoverableMsalStateError(error: unknown): boolean {
  const errorCode = getMsalErrorCode(error);
  return errorCode === 'interaction_in_progress' || errorCode === 'no_token_request_cache_error';
}

function clearMsalInteractionStorage(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
    (key): key is string => !!key,
  );
  keys.forEach((key) => {
    if (key === MSAL_INTERACTION_STATUS_KEY) {
      storage.removeItem(key);
      return;
    }
    if (!key.startsWith(MSAL_CACHE_PREFIX)) return;
    if (MSAL_TEMP_KEY_SUFFIXES.some((suffix) => key.endsWith(suffix))) {
      storage.removeItem(key);
    }
  });
}

export function clearMsalInteractionState(): void {
  clearMsalInteractionStorage(window.sessionStorage);
  clearMsalInteractionStorage(window.localStorage);
}

export function ensureMsalReady(): Promise<void> {
  if (!msalReadyPromise) {
    msalReadyPromise = (async () => {
      await msalInstance.initialize();
      try {
        // navigateToLoginRequestUrl: false → after a redirect, MSAL stays on the
        // redirect URI (/auth/microsoft/popup) instead of navigating back to the
        // login request URL (/login?microsoft=1). Returning to /login?microsoft=1
        // re-triggers loginRedirect → infinite redirect loop (code redeems but the
        // app never settles). MicrosoftPopupCallbackPage drives navigation to / itself.
        // NOTE: in @azure/msal-browser v5 this option moved from the config object
        // to the handleRedirectPromise() argument.
        await msalInstance.handleRedirectPromise({ navigateToLoginRequestUrl: false });
      } catch (error) {
        if (isRecoverableMsalStateError(error)) {
          clearMsalInteractionState();
          return;
        }
        throw error;
      }
    })().catch((error) => {
      msalReadyPromise = null;
      throw error;
    });
  }
  return msalReadyPromise;
}

export const STORAGE_API_SCOPES: string[] = import.meta.env.VITE_ENTRA_STORAGE_API_SCOPE
  ? [import.meta.env.VITE_ENTRA_STORAGE_API_SCOPE]
  : [];
