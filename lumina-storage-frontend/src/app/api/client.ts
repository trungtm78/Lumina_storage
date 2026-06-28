import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { toast } from "sonner";
import { useAuthStore, getStorageAuthMode } from "@/app/stores/authStore";
import { acquireDriverApiToken } from "@/app/hooks/useMicrosoftToken";

const BASE_URL = import.meta.env.VITE_API_PREFIX;

export const axiosClient = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  paramsSerializer: (params) => {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        value.forEach((v) => searchParams.append(key, String(v)));
      } else if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    return searchParams.toString();
  },
});

function setAuthHeader(
  headers: InternalAxiosRequestConfig["headers"],
  token?: string
) {
  const axiosHeaders = AxiosHeaders.from(headers ?? {});

  if (token) {
    axiosHeaders.set("Authorization", `Bearer ${token}`);
  } else {
    axiosHeaders.delete("Authorization");
  }

  return axiosHeaders;
}

function isPublicPath(pathname: string) {
  return pathname === "/" || pathname === "/login";
}

function logoutAndRedirect() {
  useAuthStore.getState().clearAuth();

  if (!isPublicPath(window.location.pathname)) {
    window.location.href = "/login";
  }
}

/* =========================
   EXTEND AXIOS CONFIG
========================= */
declare module "axios" {
  export interface InternalAxiosRequestConfig {
    skipAuth?: boolean;
    skipErrorToast?: boolean;
    _retry?: boolean;
  }
}

/* =========================
   REFRESH TOKEN STATE
========================= */
let isRefreshing = false;

let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error?: unknown, token?: string) => {
  failedQueue.forEach((p) => {
    if (error) {
      p.reject(error);
    } else if (token) {
      p.resolve(token);
    } else {
      p.reject(new Error("No token returned from refresh"));
    }
  });

  failedQueue = [];
};

/* =========================
   REQUEST INTERCEPTOR
========================= */
axiosClient.interceptors.request.use((config) => {
  const headers = AxiosHeaders.from(config.headers ?? {});
  const isFormData =
    typeof FormData !== "undefined" && config.data instanceof FormData;

  if (isFormData) {
    headers.delete("Content-Type");
  } else if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (!config.skipAuth) {
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  config.headers = headers;
  return config;
});

/* =========================
   RESPONSE INTERCEPTOR
========================= */
axiosClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as
      | InternalAxiosRequestConfig
      | undefined;
    const status = error.response?.status;

    if (!originalRequest) {
      return Promise.reject(error);
    }

    // ── Non-401: show toast and reject ──
    if (status !== 401) {
      if (!originalRequest.skipErrorToast) {
        if (error.response) {
          const { data } = error.response as {
            data: { detail?: unknown; message?: string };
          };
          // FastAPI 422 returns `detail` as a list of {loc, msg, type} objects,
          // and some custom validators return an object (e.g. { issues: [...] }).
          // toast.error() must receive a STRING — passing an object/array makes
          // sonner render it as a React child and crashes the whole app (white screen).
          const detail = data?.detail;
          let message: string;
          if (typeof detail === "string") {
            message = detail;
          } else if (Array.isArray(detail)) {
            message =
              detail
                .map((e) => (e && typeof e === "object" ? (e as { msg?: string }).msg : String(e)))
                .filter(Boolean)
                .join("; ") || "Dữ liệu không hợp lệ.";
          } else if (detail && typeof detail === "object") {
            const d = detail as { message?: string; msg?: string };
            message = d.message || d.msg || "Yêu cầu không hợp lệ.";
          } else {
            message = data?.message || `Request failed with status ${status}`;
          }
          toast.error(message);
        } else if (error.request) {
          if (!axios.isCancel(error)) {
            toast.error("Network error. Please check your connection.");
          }
        } else {
          toast.error(error.message);
        }
      }
      return Promise.reject(error);
    }

    // ── 401 handling ──
    if (originalRequest.skipAuth) {
      return Promise.reject(error);
    }

    const requestUrl = originalRequest.url ?? "";
    const isRefreshRequest = requestUrl.includes("/auth/refresh");
    const isLogoutRequest = requestUrl.includes("/auth/logout");
    const isLoginRequest = requestUrl.includes("/auth/login");

    if (isRefreshRequest || isLogoutRequest) {
      logoutAndRedirect();
      return Promise.reject(error);
    }

    if (isLoginRequest) {
      return Promise.reject(error);
    }

    if (originalRequest._retry) {
      logoutAndRedirect();
      return Promise.reject(error);
    }

    // ── Microsoft MSAL token refresh ──────────────────────────────────────
    if (getStorageAuthMode() === "microsoft_msal") {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token) => {
              originalRequest.headers = setAuthHeader(originalRequest.headers, token);
              resolve(axiosClient(originalRequest));
            },
            reject,
          });
        });
      }
      originalRequest._retry = true;
      isRefreshing = true;
      try {
        const newToken = await acquireDriverApiToken({ interactive: false });
        useAuthStore.getState().setToken(newToken);
        processQueue(undefined, newToken);
        originalRequest.headers = setAuthHeader(originalRequest.headers, newToken);
        return axiosClient(originalRequest);
      } catch (err) {
        processQueue(err);
        logoutAndRedirect();
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    // SSO session tokens don't have a local refresh token — skip refresh attempt
    const currentToken = useAuthStore.getState().accessToken;
    if (currentToken) {
      try {
        const claims = JSON.parse(atob(currentToken.split('.')[1]));
        if (claims?.keycloak_sub) {
          logoutAndRedirect();
          return Promise.reject(error);
        }
      } catch { /* not a JWT, proceed with normal refresh */ }
    }

    // Queue requests while refreshing
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token) => {
            originalRequest.headers = setAuthHeader(
              originalRequest.headers,
              token
            );
            resolve(axiosClient(originalRequest));
          },
          reject,
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      // Cookie carries the refresh token automatically
      const refreshRes = await axios.post(
        `${BASE_URL}/auth/refresh`,
        {},
        { withCredentials: true }
      );

      const newAccessToken = refreshRes.data?.access_token;

      if (!newAccessToken) {
        throw new Error("Refresh succeeded but access_token is missing");
      }

      useAuthStore.getState().setToken(newAccessToken);

      processQueue(undefined, newAccessToken);

      originalRequest.headers = setAuthHeader(
        originalRequest.headers,
        newAccessToken
      );

      return axiosClient(originalRequest);
    } catch (err) {
      processQueue(err);
      logoutAndRedirect();
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  }
);
