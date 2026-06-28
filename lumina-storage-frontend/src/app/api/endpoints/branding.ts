import { http } from "@/app/api/http";
import { axiosClient } from "@/app/api/client";
import { API_ENDPOINTS } from "@/app/api/endpoints";

export interface BrandingSettings {
  title: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string | null;
  accent_color: string | null;
  description: string | null;
  contact_email: string | null;
  help_url: string | null;
}

export interface BrandingUpdateRequest {
  title?: string;
  logo_url?: string | null;
  favicon_url?: string | null;
  primary_color?: string;
  secondary_color?: string | null;
  accent_color?: string | null;
  description?: string | null;
  contact_email?: string | null;
  help_url?: string | null;
}

export interface BrandingResponse {
  success: boolean;
  data: BrandingSettings;
  message?: string;
}

export interface UploadResponse {
  success: boolean;
  message: string;
  data: {
    url: string;
    filename: string;
  };
}

export const brandingApi = {
  get() {
    return http.get<BrandingResponse>(
      API_ENDPOINTS.system.branding,
      undefined,
      {
        skipAuth: true,
      }
    );
  },

  update(data: BrandingUpdateRequest) {
    return http.put<BrandingResponse>(API_ENDPOINTS.system.branding, data);
  },

  reset() {
    return http.post<BrandingResponse>(API_ENDPOINTS.system.brandingReset);
  },

  async uploadLogo(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await axiosClient.post<UploadResponse>(
      API_ENDPOINTS.upload.logo,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return res.data;
  },

  async uploadFavicon(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await axiosClient.post<UploadResponse>(
      API_ENDPOINTS.upload.favicon,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return res.data;
  },
};
