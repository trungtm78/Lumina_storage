export interface StorageConfigResponse {
  id: string;
  name: string;
  backend_type: string;
  config: Record<string, unknown>;
  is_default: boolean;
  is_active: boolean;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface StorageConfigCreateRequest {
  name: string;
  backend_type: string;
  config: Record<string, unknown>;
  is_default?: boolean;
}

export interface StorageConfigUpdateRequest {
  name?: string;
  backend_type?: string;
  config?: Record<string, unknown>;
  is_active?: boolean;
}

export interface UserStorageConfigCreateRequest {
  name: string;
  backend_type: string;
  config: Record<string, unknown>;
}
