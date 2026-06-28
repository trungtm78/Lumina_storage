export interface GroupResponse {
  id: string;
  name: string;
  description: string | null;
  type: "manual" | "auto";
  is_select_all: boolean;
  filter_role_id: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
}

export interface UserBriefResponse {
  id: string;
  username: string;
  full_name: string;
  email: string;
  is_active: boolean;
}

export interface GroupMemberResponse {
  id: string;
  username: string;
  full_name: string;
  email: string;
  is_active: boolean;
  role: { id: string; name: string } | null;
}

export interface GroupDetailResponse extends GroupResponse {
  members: UserBriefResponse[];
}

export interface GroupCreateRequest {
  name: string;
  description?: string | null;
  type: "manual" | "auto";
  is_select_all?: boolean;
  exclude_ids?: string[];
  filter_role_id?: string | null;
  user_ids?: string[];
}

export interface GroupUpdateRequest {
  name?: string;
  description?: string | null;
  is_select_all?: boolean;
  user_ids?: string[];
  exclude_ids?: string[];
  filter_role_id?: string | null;
}
