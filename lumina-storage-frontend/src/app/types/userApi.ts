import type { RoleForMe } from "./auth";

export interface UserGroupBrief {
  id: string;
  name: string;
  type: "manual" | "auto";
}

export interface UserPreference {
  locale: "vi" | "en";
}

export interface UserResponse {
  id: string;
  username: string;
  email: string;
  full_name: string;
  avatar: string | null;
  is_active: boolean;
  locale: string;
  last_login: string | null;
  created_at: string;
  updated_at: string;
  role: RoleForMe | null;
  groups?: UserGroupBrief[];
}

export interface UserUpdateRequest {
  full_name?: string;
  avatar?: string;
  is_active?: boolean;
  // is_superuser?: boolean;
  email?: string;
}
