export interface SystemConfigResponse {
  id: number;
  key: string;
  value: unknown;
  description: string | null;
  is_public: boolean;
  updated_at: string;
  updated_by_id: string | null;
}

export interface PublicConfigResponse {
  key: string;
  value: unknown;
}

export interface SystemConfigCreateRequest {
  key: string;
  value: unknown;
  description?: string;
  is_public?: boolean;
}

export interface SystemConfigUpdateRequest {
  value?: unknown;
  description?: string;
  is_public?: boolean;
}
