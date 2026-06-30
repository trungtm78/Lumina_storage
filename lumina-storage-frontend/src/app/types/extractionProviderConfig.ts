// Phase 5b — types cấu hình provider trích xuất (mirror aiModelConfig). Response OMIT api_key.

export interface ExtractionProviderConfigResponse {
  id: string;
  name: string;
  provider: string;
  base_url: string | null;
  options: Record<string, unknown> | null;
  applies_to: string[] | null; // mime/ext routing; null/["*"] = mọi loại
  priority: number;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExtractionProviderConfigCreateRequest {
  name: string;
  provider: string;
  api_key?: string;
  base_url?: string;
  options?: Record<string, unknown>;
  applies_to?: string[];
  priority?: number;
  is_default?: boolean;
}

export interface ExtractionProviderConfigUpdateRequest {
  name?: string;
  provider?: string;
  api_key?: string;
  base_url?: string;
  options?: Record<string, unknown>;
  applies_to?: string[];
  priority?: number;
  is_active?: boolean;
}

export interface ExtractionProviderConfigTestRequest {
  provider: string;
  api_key?: string;
  base_url?: string;
  options?: Record<string, unknown>;
  config_id?: string;
}

export interface ExtractionProviderConfigTestResponse {
  success: boolean;
  message: string;
}
