export interface RoleResponse {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoleCreateRequest {
  name: string;
  description?: string;
}

export interface RoleUpdateRequest {
  name?: string;
  description?: string;
}

export interface MenuPermission {
  id: number;
  name: string;
  urlpath: string;
}

export interface RoleMenuPermissionItem {
  menu_permission_id: number;
  level: number;
}

export type RoleMenuPermissionsResponse = {
  menu_permission_id: number;
  level: number;
}[];
