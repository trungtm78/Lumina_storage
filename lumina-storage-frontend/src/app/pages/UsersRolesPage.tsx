import { useState, useEffect, useCallback } from "react";
import { useSearchParams, Navigate } from "react-router";
import { HelpCircle, Plus } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { usersApi, rolesApi } from "@/app/api/endpoints/users";
import { groupsApi } from "@/app/api/endpoints/groups";
import { useAuthStore } from "@/app/stores/authStore";
import { authApi } from "@/app/api/endpoints/auth";
import { usePermission } from "@/app/hooks/usePermission";
import type {
  UserResponse,
  RoleResponse,
  GroupResponse,
} from "@/app/types/api";
import { toast } from "sonner";

import { AddUserDialog } from "@/app/components/user-role/AddUserDialog";
import { EditRoleDialog } from "@/app/components/user-role/EditRoleDialog";
import { ViewRoleDialog } from "@/app/components/user-role/ViewRoleDialog";
import { ConfirmDeleteModal } from "@/app/components/ConfirmDeleteModal";
import {
  GroupFormDialog,
  type GroupFormState,
} from "@/app/components/user-role/GroupFormDialog";
import { ViewGroupMembersDialog } from "@/app/components/user-role/ViewGroupMembersDialog";
import { UsersTab } from "@/app/components/user-role/UsersTab";
import { GroupsTab } from "@/app/components/user-role/GroupsTab";
import { RolesTab } from "@/app/components/user-role/RolesTab";

const PAGE_SIZE = 10;

export function UsersRolesPage() {
  const { t } = useTranslation();
  const { canRead, canWrite } = usePermission();
  const queryClient = useQueryClient();

  // Pagination state
  const [usersPage, setUsersPage] = useState(1);
  const [rolesPage, setRolesPage] = useState(1);
  const [groupsPage, setGroupsPage] = useState(1);

  // Users search/filter state
  const [usersSearchInput, setUsersSearchInput] = useState("");
  const [usersSearch, setUsersSearch] = useState("");
  const [usersRoleFilter, setUsersRoleFilter] = useState<string[]>([]);
  const [usersGroupFilter, setUsersGroupFilter] = useState<string[]>([]);
  const [usersStatusFilter, setUsersStatusFilter] = useState("");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setUsersSearch(usersSearchInput);
      setUsersPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [usersSearchInput]);

  // Reset page on filter change
  useEffect(() => {
    setUsersPage(1);
  }, [usersRoleFilter, usersGroupFilter, usersStatusFilter]);

  // Groups search/filter state
  const [groupsSearchInput, setGroupsSearchInput] = useState("");
  const [groupsSearch, setGroupsSearch] = useState("");
  const [groupsTypeFilter, setGroupsTypeFilter] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setGroupsSearch(groupsSearchInput);
      setGroupsPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [groupsSearchInput]);
  useEffect(() => {
    setGroupsPage(1);
  }, [groupsTypeFilter]);

  // Roles search state
  const [rolesSearchInput, setRolesSearchInput] = useState("");
  const [rolesSearch, setRolesSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setRolesSearch(rolesSearchInput);
      setRolesPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [rolesSearchInput]);

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: [
      "users",
      {
        page: usersPage,
        search: usersSearch,
        role_id: usersRoleFilter,
        group_id: usersGroupFilter,
        status: usersStatusFilter,
      },
    ],
    queryFn: () =>
      usersApi.list({
        page: usersPage,
        page_size: PAGE_SIZE,
        search: usersSearch || undefined,
        role_id: usersRoleFilter.length > 0 ? usersRoleFilter : undefined,
        group_id: usersGroupFilter.length > 0 ? usersGroupFilter : undefined,
        is_active:
          usersStatusFilter === "active"
            ? true
            : usersStatusFilter === "inactive"
              ? false
              : undefined,
      }),
  });

  const { data: rolesData } = useQuery({
    queryKey: ["roles", { page: rolesPage, search: rolesSearch }],
    queryFn: () =>
      rolesApi.list({
        page: rolesPage,
        page_size: PAGE_SIZE,
        search: rolesSearch || undefined,
      }),
  });

  const { data: groupsData } = useQuery({
    queryKey: [
      "groups",
      { page: groupsPage, search: groupsSearch, type: groupsTypeFilter },
    ],
    queryFn: () =>
      groupsApi.list({
        page: groupsPage,
        page_size: PAGE_SIZE,
        search: groupsSearch || undefined,
        type: groupsTypeFilter || undefined,
      }),
  });

  // Filter-list queries for dropdowns (full list, separate from paginated)
  const { data: allRolesForFilter } = useQuery({
    queryKey: ["roles-filter-list"],
    queryFn: () => rolesApi.list({ page: 1, page_size: 20 }),
    staleTime: 5 * 60 * 1000,
  });
  const { data: allGroupsForFilter } = useQuery({
    queryKey: ["groups-filter-list"],
    queryFn: () => groupsApi.list({ page: 1, page_size: 20 }),
    staleTime: 5 * 60 * 1000,
  });

  const users = usersData?.items ?? [];
  const roles = rolesData?.items ?? [];
  const groups = groupsData?.items ?? [];
  const allRoles = allRolesForFilter?.items ?? [];
  const allGroups = allGroupsForFilter?.items ?? [];

  // User dialogs
  const [showAddUserDialog, setShowAddUserDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<UserResponse | null>(null);

  // Role dialogs
  const [showEditRoleDialog, setShowEditRoleDialog] = useState(false);
  const [showViewRoleDialog, setShowViewRoleDialog] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleResponse | null>(null);
  const [viewingRole, setViewingRole] = useState<RoleResponse | null>(null);

  // Group dialogs
  const [showGroupFormDialog, setShowGroupFormDialog] = useState(false);
  const [showGroupMembersDialog, setShowGroupMembersDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupResponse | null>(null);
  const [viewingGroup, setViewingGroup] = useState<GroupResponse | null>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    type: "user-deactivate" | "user-delete" | "role" | "group";
  } | null>(null);

  /* ── Mutations ───────────────────────────────────────────── */

  const addUserMutation = useMutation({
    mutationFn: async (payload: {
      username: string;
      email: string;
      password: string;
      fullName: string;
      roleId: string;
      manualGroupIds: string[];
    }) => {
      const newUser = await authApi.register({
        username: payload.username,
        email: payload.email,
        password: payload.password,
        full_name: payload.fullName,
      });
      if (payload.roleId) {
        await rolesApi.addMember(payload.roleId, newUser.id);
      }
      for (const groupId of payload.manualGroupIds) {
        await groupsApi.addMember(groupId, newUser.id);
      }
      return newUser;
    },
    onSuccess: (newUser) => {
      queryClient.invalidateQueries({ queryKey: ["users"], exact: false });
      toast.success(`User "${newUser.username}" has been created`);
    },
    onError: () => toast.error("Failed to create user"),
  });

  const editUserMutation = useMutation({
    mutationFn: async (payload: {
      userId: string;
      fullName: string;
      email: string;
      isActive: boolean;
      roleId: string;
      oldRoleId: string;
    }) => {
      const updated = await usersApi.update(payload.userId, {
        full_name: payload.fullName,
        email: payload.email,
        is_active: payload.isActive,
      });
      if (payload.oldRoleId !== payload.roleId) {
        if (payload.oldRoleId) {
          await rolesApi.removeMember(payload.oldRoleId, payload.userId);
        }
        if (payload.roleId) {
          await rolesApi.addMember(payload.roleId, payload.userId);
        }
      }
      return updated;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["users"], exact: false });
      toast.success(`User "${updated.username}" has been updated`);
    },
    onError: () => toast.error("Failed to update user"),
  });

  const deactivateUserMutation = useMutation({
    mutationFn: (userId: string) => usersApi.deactivate(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"], exact: false });
      toast.success("User has been deactivated");
    },
    onError: () => toast.error("Failed to deactivate user"),
  });

  const hardDeleteUserMutation = useMutation({
    mutationFn: (userId: string) => usersApi.deletePermanently(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"], exact: false });
      toast.success("User has been permanently deleted");
    },
    onError: () => toast.error("Failed to delete user"),
  });

  const saveRoleMutation = useMutation({
    mutationFn: async (payload: {
      roleData: {
        name: string;
        description: string;
        menuPermissions: { menu_permission_id: number; level: number }[];
      };
      editingRoleId?: string;
    }) => {
      let roleId = payload.editingRoleId;
      let saved: RoleResponse;
      if (payload.editingRoleId) {
        saved = await rolesApi.update(payload.editingRoleId, {
          name: payload.roleData.name,
          description: payload.roleData.description || undefined,
        });
      } else {
        saved = await rolesApi.create({
          name: payload.roleData.name,
          description: payload.roleData.description || undefined,
        });
        roleId = saved.id;
      }
      await rolesApi.setMenuPermissions(
        roleId!,
        payload.roleData.menuPermissions
      );
      return saved;
    },
    onSuccess: (saved, payload) => {
      queryClient.invalidateQueries({ queryKey: ["roles"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["roles-filter-list"] });
      if (payload.editingRoleId) {
        queryClient.invalidateQueries({
          queryKey: ["roles", payload.editingRoleId, "menu-permissions"],
        });
        const currentProfile = useAuthStore.getState().profile;
        if (currentProfile?.role?.id === payload.editingRoleId) {
          void useAuthStore.getState().fetchProfile();
        }
      }
      toast.success(
        `Role "${saved.name}" has been ${payload.editingRoleId ? "updated" : "created"}`
      );
    },
    onError: () => toast.error("Failed to save role"),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (roleId: string) => rolesApi.delete(roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["roles-filter-list"] });
      toast.success("Role has been deleted");
    },
    onError: () => toast.error("Failed to delete role"),
  });

  const saveGroupMutation = useMutation({
    mutationFn: async (payload: {
      formData: GroupFormState;
      editingGroupId?: string;
    }) => {
      const { formData, editingGroupId } = payload;

      // Build the body based on type and is_select_all
      const manualPayload =
        formData.type === "manual"
          ? formData.is_select_all
            ? {
                is_select_all: true as const,
                exclude_ids: formData.exclude_ids,
              }
            : {
                user_ids: formData.user_ids,
              }
          : {
              filter_role_id: formData.filter_role_id || null,
            };
      if (editingGroupId) {
        return groupsApi.update(editingGroupId, {
          name: formData.name,
          description: formData.description || null,
          ...manualPayload,
        });
      } else {
        return groupsApi.create({
          name: formData.name,
          description: formData.description || null,
          type: formData.type,
          ...manualPayload,
        });
      }
    },
    onSuccess: (saved, payload) => {
      queryClient.invalidateQueries({ queryKey: ["groups"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["groups-filter-list"] });
      toast.success(
        `Group "${saved.name}" has been ${payload.editingGroupId ? "updated" : "created"}`
      );
    },
    onError: () => toast.error("Failed to save group"),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (groupId: string) => groupsApi.delete(groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["groups-filter-list"] });
      toast.success("Group has been deleted");
    },
    onError: () => toast.error("Failed to delete group"),
  });

  /* ── Handlers ────────────────────────────────────────────── */

  const handleAddUser = (payload: {
    username: string;
    email: string;
    password: string;
    fullName: string;
    roleId: string;
    manualGroupIds: string[];
  }) => {
    addUserMutation.mutate(payload);
  };

  const handleEditUser = (
    userId: string,
    payload: {
      fullName: string;
      email: string;
      isActive: boolean;
      roleId: string;
    }
  ) => {
    editUserMutation.mutate({
      userId,
      ...payload,
      oldRoleId: editingUser?.role?.id ?? "",
    });
  };

  const handleSaveRole = (roleData: {
    name: string;
    description: string;
    menuPermissions: { menu_permission_id: number; level: number }[];
  }) => {
    saveRoleMutation.mutate({
      roleData,
      editingRoleId: editingRole?.id,
    });
  };

  const handleSaveGroup = (formData: GroupFormState) => {
    saveGroupMutation.mutate(
      { formData, editingGroupId: editingGroup?.id },
      {
        onSuccess: () => {
          setShowGroupFormDialog(false);
          setEditingGroup(null);
        },
      }
    );
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "user-deactivate") {
      deactivateUserMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "user-delete") {
      hardDeleteUserMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "role") {
      deleteRoleMutation.mutate(deleteTarget.id);
    } else {
      deleteGroupMutation.mutate(deleteTarget.id);
    }
    setDeleteTarget(null);
  };

  const deleteTargetName = (() => {
    if (!deleteTarget) return "";
    if (
      deleteTarget.type === "user-deactivate" ||
      deleteTarget.type === "user-delete"
    ) {
      return users.find((u) => u.id === deleteTarget.id)?.username ?? "";
    }
    if (deleteTarget.type === "role") {
      return roles.find((r) => r.id === deleteTarget.id)?.name ?? "";
    }
    return groups.find((g) => g.id === deleteTarget.id)?.name ?? "";
  })();

  const [searchParams, setSearchParams] = useSearchParams();
  const VALID_TABS = ["users", "groups", "roles"] as const;
  type Tab = (typeof VALID_TABS)[number];
  const tabParam = searchParams.get("tab");
  const activeTab: Tab = VALID_TABS.includes(tabParam as Tab)
    ? (tabParam as Tab)
    : "users";

  const setActiveTab = useCallback(
    (tab: Tab) => {
      setSearchParams({ tab }, { replace: true });
    },
    [setSearchParams]
  );

  /* ── Render ──────────────────────────────────────────────── */

  if (!canRead) {
    return <Navigate to="/error" replace />;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">
                Users, Groups &amp; Roles
              </h1>
              <HelpCircle className="h-4 w-4 text-gray-400" />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Manage user accounts, groups, and permission roles
            </p>
          </div>

          {canWrite && activeTab === "users" && (
            <button
              onClick={() => setShowAddUserDialog(true)}
              className="bg-brand-500 hover:bg-brand-600 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add User
            </button>
          )}
          {canWrite && activeTab === "groups" && (
            <button
              onClick={() => {
                setEditingGroup(null);
                setShowGroupFormDialog(true);
              }}
              className="bg-brand-500 hover:bg-brand-600 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Group
            </button>
          )}
          {canWrite && activeTab === "roles" && (
            <button
              onClick={() => {
                setEditingRole(null);
                setShowEditRoleDialog(true);
              }}
              className="bg-brand-500 hover:bg-brand-600 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Role
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-1 border-b border-gray-200">
          {(["users", "groups", "roles"] as const).map((tab) => {
            const count =
              tab === "users"
                ? usersData?.total
                : tab === "groups"
                  ? groupsData?.total
                  : rolesData?.total;
            const label =
              tab === "users"
                ? t("users.tabs.users")
                : tab === "groups"
                  ? t("users.tabs.groups")
                  : t("users.tabs.roles");
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative -mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "border-brand-500 text-brand-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {label}
                {count !== undefined && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      activeTab === tab
                        ? "bg-brand-100 text-brand-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 w-full flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full space-y-4">
          {activeTab === "users" && (
            <UsersTab
              users={users}
              usersLoading={usersLoading}
              usersSearchInput={usersSearchInput}
              onSearchChange={setUsersSearchInput}
              allRoles={allRoles}
              allGroups={allGroups}
              usersRoleFilter={usersRoleFilter}
              onRoleFilterToggle={(id) =>
                setUsersRoleFilter((prev) =>
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id]
                )
              }
              usersGroupFilter={usersGroupFilter}
              onGroupFilterToggle={(id) =>
                setUsersGroupFilter((prev) =>
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id]
                )
              }
              usersStatusFilter={usersStatusFilter}
              onStatusFilterChange={setUsersStatusFilter}
              usersPage={usersPage}
              usersTotal={usersData?.total ?? 0}
              pageSize={PAGE_SIZE}
              onPageChange={setUsersPage}
              {...(canWrite && {
                onEditUser: (user) => {
                  setEditingUser(user);
                  setShowAddUserDialog(true);
                },
                onDeleteUser: (userId) =>
                  setDeleteTarget({ id: userId, type: "user-deactivate" }),
                onHardDeleteUser: (userId) =>
                  setDeleteTarget({ id: userId, type: "user-delete" }),
              })}
            />
          )}

          {activeTab === "groups" && (
            <GroupsTab
              groups={groups}
              groupsSearchInput={groupsSearchInput}
              onSearchChange={setGroupsSearchInput}
              groupsTypeFilter={groupsTypeFilter}
              onTypeFilterChange={setGroupsTypeFilter}
              groupsPage={groupsPage}
              groupsTotal={groupsData?.total ?? 0}
              pageSize={PAGE_SIZE}
              onPageChange={setGroupsPage}
              onViewMembers={(group) => {
                setViewingGroup(group);
                setShowGroupMembersDialog(true);
              }}
              {...(canWrite && {
                onEditGroup: (group) => {
                  setEditingGroup(group);
                  setShowGroupFormDialog(true);
                },
                onDeleteGroup: (groupId) =>
                  setDeleteTarget({ id: groupId, type: "group" }),
              })}
            />
          )}

          {activeTab === "roles" && (
            <RolesTab
              roles={roles}
              rolesSearchInput={rolesSearchInput}
              onSearchChange={setRolesSearchInput}
              rolesPage={rolesPage}
              rolesTotal={rolesData?.total ?? 0}
              pageSize={PAGE_SIZE}
              onPageChange={setRolesPage}
              onViewRole={(role) => {
                setViewingRole(role);
                setShowViewRoleDialog(true);
              }}
              {...(canWrite && {
                onEditRole: (role) => {
                  setEditingRole(role);
                  setShowEditRoleDialog(true);
                },
                onDeleteRole: (roleId) =>
                  setDeleteTarget({ id: roleId, type: "role" }),
              })}
            />
          )}
        </div>
      </div>

      {/* ── Dialogs ─────────────────────────────────────────── */}
      <AddUserDialog
        open={showAddUserDialog}
        onClose={() => {
          setShowAddUserDialog(false);
          setEditingUser(null);
        }}
        onAddUser={handleAddUser}
        onEditUser={handleEditUser}
        availableRoles={roles.map((r) => ({ id: r.id, name: r.name }))}
        availableGroups={groups.map((g) => ({
          id: g.id,
          name: g.name,
          type: g.type,
          filter_role_id: g.filter_role_id,
        }))}
        user={editingUser}
      />

      <EditRoleDialog
        open={showEditRoleDialog}
        onClose={() => setShowEditRoleDialog(false)}
        onSave={handleSaveRole}
        role={
          editingRole
            ? {
                id: editingRole.id,
                name: editingRole.name,
                description: editingRole.description,
              }
            : null
        }
      />

      <ViewRoleDialog
        open={showViewRoleDialog}
        onClose={() => setShowViewRoleDialog(false)}
        role={viewingRole}
        users={users}
      />

      <GroupFormDialog
        open={showGroupFormDialog}
        onClose={() => {
          setShowGroupFormDialog(false);
          setEditingGroup(null);
        }}
        onSave={handleSaveGroup}
        group={editingGroup}
        roles={roles}
        isSaving={saveGroupMutation.isPending}
        allRoles={allRoles.map((r) => ({ id: r.id, name: r.name }))}
        allGroups={allGroups.map((g) => ({
          id: g.id,
          name: g.name,
          type: g.type,
        }))}
      />

      <ViewGroupMembersDialog
        open={showGroupMembersDialog}
        onClose={() => {
          setShowGroupMembersDialog(false);
          setViewingGroup(null);
        }}
        group={viewingGroup}
      />

      <ConfirmDeleteModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title={
          deleteTarget?.type === "user-deactivate"
            ? "Deactivate user"
            : deleteTarget?.type === "user-delete"
              ? "Permanently delete user"
              : deleteTarget?.type === "group"
                ? "Delete group"
                : "Delete role"
        }
        description={
          deleteTarget?.type === "user-deactivate"
            ? `Are you sure you want to deactivate "${deleteTargetName}"? This user will no longer be able to access the system.`
            : deleteTarget?.type === "user-delete"
              ? `Are you sure you want to permanently delete "${deleteTargetName}"? This action cannot be undone.`
              : deleteTarget?.type === "group"
                ? `Are you sure you want to delete group "${deleteTargetName}"? This action cannot be undone.`
                : `Are you sure you want to delete role "${deleteTargetName}"? This action cannot be undone.`
        }
        confirmLabel={
          deleteTarget?.type === "user-deactivate" ? "Deactivate" : "Delete"
        }
        isLoading={
          deactivateUserMutation.isPending ||
          hardDeleteUserMutation.isPending ||
          deleteRoleMutation.isPending ||
          deleteGroupMutation.isPending
        }
      />
    </div>
  );
}
