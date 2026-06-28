export interface SSOTokenResponse {
  access_token: string;
  // token_type: string;
  keycloak_id_token: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  full_name?: string;
}

export interface TokenResponse {
  access_token: string;
  // refresh_token: string;
  token_type: string;
  must_change_password: boolean;
}

export interface MenuPermissionItem {
  id: number;
  name: string;
  urlpath: string;
  level: number;
}

export interface RoleForMe {
  id: string;
  name: string;
  is_default: boolean;
  permissions: MenuPermissionItem[];
}

export interface MeResponse {
  id: string;
  username: string;
  email: string;
  full_name: string;
  avatar: string | null;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  updated_at: string;
  role: RoleForMe | null;
}
