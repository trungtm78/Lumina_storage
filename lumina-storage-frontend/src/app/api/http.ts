import type { AxiosRequestConfig } from "axios";
import { axiosClient } from "./client";

export type HttpConfig = AxiosRequestConfig & {
  skipAuth?: boolean;
  skipErrorToast?: boolean;
};

export const http = {
  get: async <T>(url: string, params?: unknown, config?: HttpConfig) => {
    const res = await axiosClient.get<T>(url, { params, ...config });
    return res.data;
  },

  post: async <T, B = unknown>(url: string, body?: B, config?: HttpConfig) => {
    const res = await axiosClient.post<T>(url, body, config);
    return res.data;
  },

  put: async <T, B = unknown>(url: string, body?: B, config?: HttpConfig) => {
    const res = await axiosClient.put<T>(url, body, config);
    return res.data;
  },

  patch: async <T, B = unknown>(url: string, body?: B, config?: HttpConfig) => {
    const res = await axiosClient.patch<T>(url, body, config);
    return res.data;
  },

  delete: async <T>(url: string, config?: HttpConfig) => {
    const res = await axiosClient.delete<T>(url, config);
    return res.data;
  },
};
