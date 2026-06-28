import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import type {
  GroupCreateRequest,
  GroupDetailResponse,
  GroupMemberResponse,
  GroupResponse,
  GroupUpdateRequest,
  PaginatedResponse,
} from "@/app/types/api";

export const groupsApi = {
  list(params?: {
    page?: number;
    page_size?: number;
    search?: string;
    type?: string;
  }) {
    return http.get<PaginatedResponse<GroupResponse>>(
      API_ENDPOINTS.groups.list,
      params
    );
  },

  get(id: string) {
    return http.get<GroupDetailResponse>(API_ENDPOINTS.groups.detail(id));
  },

  create(data: GroupCreateRequest) {
    return http.post<GroupResponse>(API_ENDPOINTS.groups.create, data);
  },

  update(id: string, data: GroupUpdateRequest) {
    return http.patch<GroupResponse>(API_ENDPOINTS.groups.update(id), data);
  },

  delete(id: string) {
    return http.delete(API_ENDPOINTS.groups.delete(id));
  },

  getMembers(
    id: string,
    params?: { page?: number; page_size?: number; search?: string }
  ) {
    return http.get<PaginatedResponse<GroupMemberResponse>>(
      API_ENDPOINTS.groups.members(id),
      params
    );
  },

  addMember(id: string, userId: string) {
    return http.post(API_ENDPOINTS.groups.addMember(id), { user_id: userId });
  },

  removeMember(id: string, userId: string) {
    return http.delete(API_ENDPOINTS.groups.removeMember(id, userId));
  },
};
