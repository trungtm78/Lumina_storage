export interface FolderResponse {
  id: string;
  name: string;
  parent_id: string | null;
  path: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FolderCreateRequest {
  name: string;
  parent_id?: string;
}
