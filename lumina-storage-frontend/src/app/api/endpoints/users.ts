import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import type {
  UserResponse,
  UserUpdateRequest,
  UserPreference,
  RoleResponse,
  RoleCreateRequest,
  RoleUpdateRequest,
  MenuPermission,
  RoleMenuPermissionsResponse,
  RoleMenuPermissionItem,
  PaginatedResponse,
  GroupResponse,
} from "@/app/types/api";
import type { UserSearchResult } from "@/app/types/documentPermission";

export const usersApi = {
  search(q: string) {
    return http.get<UserSearchResult[]>(API_ENDPOINTS.users.search, { q });
  },
  list(params?: {
    page?: number;
    page_size?: number;
    search?: string;
    role_id?: string[];
    group_id?: string[];
    is_active?: boolean;
  }) {
    return http.get<PaginatedResponse<UserResponse>>(
      API_ENDPOINTS.users.list,
      params
    );
  },

  get(id: string) {
    return http.get<UserResponse>(API_ENDPOINTS.users.detail(id));
  },

  changePassword(data: { current_password: string; new_password: string }) {
    return http.post(API_ENDPOINTS.users.password, data);
  },

  update(id: string, data: UserUpdateRequest) {
    return http.patch<UserResponse>(API_ENDPOINTS.users.update(id), data);
  },

  deactivate(id: string) {
    return http.delete(API_ENDPOINTS.users.deactivate(id));
  },

  deletePermanently(id: string) {
    return http.delete(API_ENDPOINTS.users.deletePermanently(id));
  },

  getPreferences() {
    return http.get<UserPreference>(API_ENDPOINTS.users.preferences);
  },

  updatePreferences(data: UserPreference) {
    return http.patch<UserPreference>(API_ENDPOINTS.users.preferences, data);
  },
};

export const rolesApi = {
  list(params?: { page?: number; page_size?: number; search?: string }) {
    return http.get<PaginatedResponse<RoleResponse>>(
      API_ENDPOINTS.roles.list,
      params
    );
  },

  get(id: string) {
    return http.get<RoleResponse>(API_ENDPOINTS.roles.detail(id));
  },

  create(data: RoleCreateRequest) {
    return http.post<RoleResponse>(API_ENDPOINTS.roles.create, data);
  },

  update(id: string, data: RoleUpdateRequest) {
    return http.patch<RoleResponse>(API_ENDPOINTS.roles.update(id), data);
  },

  delete(id: string) {
    return http.delete(API_ENDPOINTS.roles.delete(id));
  },

  addMember(roleId: string, userId: string) {
    return http.post(API_ENDPOINTS.roles.addMember(roleId), {
      user_id: userId,
    });
  },

  removeMember(roleId: string, userId: string) {
    return http.delete(API_ENDPOINTS.roles.removeMember(roleId, userId));
  },

  getMenuPermissions(roleId: string) {
    return http.get<RoleMenuPermissionsResponse>(
      API_ENDPOINTS.roles.menuPermissions(roleId)
    );
  },

  setMenuPermissions(roleId: string, items: RoleMenuPermissionItem[]) {
    return http.put(API_ENDPOINTS.roles.menuPermissions(roleId), { items });
  },

  getAutoGroup(roleId: string) {
    return http.get<GroupResponse | null>(
      API_ENDPOINTS.roles.autoGroup(roleId)
    );
  },
};

export const permissionsApi = {
  listMenuPermissions() {
    return http.get<MenuPermission[]>(API_ENDPOINTS.permissions.menu);
  },
};
