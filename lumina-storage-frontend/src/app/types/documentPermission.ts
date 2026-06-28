export interface DocumentPermissionResponse {
  id: string;
  document_id: string | null;
  folder_id: string | null;
  group_id: string | null;
  group_name: string | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  permission: "viewer" | "editor" | "manager";
  created_at: string;
  created_by_id: string;
}

export interface DocumentPermissionCreateRequest {
  group_id?: string;
  user_id?: string;
  permission: "viewer" | "editor" | "manager";
}

export interface DocumentPermissionUpdateRequest {
  permission: "viewer" | "editor" | "manager";
}

export interface UserSearchResult {
  id: string;
  full_name: string;
  email: string;
  avatar: string | null;
}
