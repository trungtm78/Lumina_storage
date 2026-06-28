export interface AIModelConfigResponse {
  id: string;
  name: string;
  provider: string;
  model_name: string;
  purpose: string;
  base_url: string | null;
  extra_config: Record<string, unknown> | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AIModelConfigCreateRequest {
  name: string;
  provider: string;
  model_name: string;
  purpose: string;
  api_key?: string;
  base_url?: string;
  extra_config?: Record<string, unknown>;
  is_default?: boolean;
}

export interface AIModelConfigUpdateRequest {
  name?: string;
  provider?: string;
  model_name?: string;
  api_key?: string;
  base_url?: string;
  extra_config?: Record<string, unknown>;
  is_active?: boolean;
}

export interface AIModelConfigTestRequest {
  model_name: string;
  provider: string;
  purpose?: string;
  api_key?: string;
  base_url?: string;
  extra_config?: Record<string, unknown>;
  config_id?: string;
}

export interface AIModelConfigTestResponse {
  success: boolean;
  message: string;
  response_preview: string | null;
}
