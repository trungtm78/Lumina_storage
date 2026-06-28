import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Shield, Trash2, Users, User, Search, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/app/components/ui/tabs";

import { groupsApi } from "@/app/api/endpoints/groups";
import { foldersApi } from "@/app/api/endpoints/folders";
import { usersApi } from "@/app/api/endpoints/users";
import {
  useDocumentPermissions,
  useShareDocument,
  useUpdateDocumentPermission,
  useRevokeDocumentPermission,
} from "@/app/hooks/useDocumentPermissions";
import type { DocumentPermissionResponse, UserSearchResult } from "@/app/types/documentPermission";
import type { GroupResponse } from "@/app/types/group";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceId: string;
  resourceType: "document" | "folder";
  resourceName: string;
  ownerId?: string | null;
}

type PermissionLevel = "viewer" | "editor" | "manager";

export function ShareDialog({
  open,
  onOpenChange,
  resourceId,
  resourceType,
  resourceName,
  ownerId,
}: ShareDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isFolder = resourceType === "folder";

  // --- Group tab state ---
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groupPermission, setGroupPermission] = useState<PermissionLevel>("viewer");

  // --- User tab state ---
  const [userQuery, setUserQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<UserSearchResult[]>([]);
  const [userPermission, setUserPermission] = useState<PermissionLevel>("viewer");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(userQuery), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [userQuery]);

  // --- Permissions queries ---
  const { data: docPermissions = [], isLoading: docPermsLoading } =
    useDocumentPermissions(!isFolder && open ? resourceId : undefined);

  const { data: folderPermissions = [], isLoading: folderPermsLoading } = useQuery({
    queryKey: ["folder-permissions", resourceId],
    queryFn: () => foldersApi.listPermissions(resourceId),
    enabled: isFolder && open,
  });

  const permissions: DocumentPermissionResponse[] = isFolder ? folderPermissions : docPermissions;
  const permsLoading = isFolder ? folderPermsLoading : docPermsLoading;

  // --- Groups query ---
  const { data: groupsData } = useQuery({
    queryKey: ["groups"],
    queryFn: () => groupsApi.list({ page: 1, page_size: 100 }),
    enabled: open,
  });
  const groups: GroupResponse[] = groupsData?.items ?? [];

  // --- User search query ---
  const { data: searchedUsers = [], isFetching: searchLoading } = useQuery({
    queryKey: ["users-search", debouncedQuery],
    queryFn: () => usersApi.search(debouncedQuery),
    enabled: open,
  });

  // --- Mutations ---
  const shareMutation = useShareDocument();
  const updateMutation = useUpdateDocumentPermission();
  const revokeMutation = useRevokeDocumentPermission();

  const shareFolderMutation = useMutation({
    mutationFn: ({ folderId, data }: { folderId: string; data: { group_id?: string; user_id?: string; permission: PermissionLevel } }) =>
      foldersApi.shareFolder(folderId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["folder-permissions", resourceId] }),
  });
  const updateFolderPermMutation = useMutation({
    mutationFn: ({ folderId, permId, data }: { folderId: string; permId: string; data: { permission: PermissionLevel } }) =>
      foldersApi.updatePermission(folderId, permId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["folder-permissions", resourceId] }),
  });
  const revokeFolderPermMutation = useMutation({
    mutationFn: ({ folderId, permId }: { folderId: string; permId: string }) =>
      foldersApi.revokePermission(folderId, permId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["folder-permissions", resourceId] }),
  });

  const sharedGroupIds = new Set(permissions.filter((p) => p.group_id).map((p) => p.group_id!));
  const sharedUserIds = new Set(permissions.filter((p) => p.user_id).map((p) => p.user_id!));
  const availableGroups = groups.filter((g) => !sharedGroupIds.has(g.id));
  const filteredUsers = searchedUsers.filter((u) => !sharedUserIds.has(u.id) && u.id !== ownerId);

  const allGroupsSelected =
    availableGroups.length > 0 && availableGroups.every((g) => selectedGroupIds.includes(g.id));

  const toggleSelectAll = () => {
    setSelectedGroupIds(allGroupsSelected ? [] : availableGroups.map((g) => g.id));
  };

  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const toggleUser = (user: UserSearchResult) => {
    setSelectedUsers((prev) =>
      prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]
    );
  };

  const doShare = async (data: { group_id?: string; user_id?: string; permission: PermissionLevel }) => {
    if (isFolder) {
      await shareFolderMutation.mutateAsync({ folderId: resourceId, data });
    } else {
      await shareMutation.mutateAsync({ documentId: resourceId, data });
    }
  };

  const handleShareGroups = async () => {
    if (selectedGroupIds.length === 0) return;
    try {
      await Promise.all(selectedGroupIds.map((id) => doShare({ group_id: id, permission: groupPermission })));
      setSelectedGroupIds([]);
      toast.success(t("documents.shareSuccess"));
    } catch {
      // interceptor shows the backend error message
    }
  };

  const handleShareUsers = async () => {
    if (selectedUsers.length === 0) return;
    try {
      await Promise.all(selectedUsers.map((u) => doShare({ user_id: u.id, permission: userPermission })));
      setSelectedUsers([]);
      setUserQuery("");
      toast.success(t("documents.shareSuccess"));
    } catch {
      // interceptor shows the backend error message
    }
  };

  const handleUpdate = async (perm: DocumentPermissionResponse, newPermission: string) => {
    try {
      if (isFolder) {
        await updateFolderPermMutation.mutateAsync({ folderId: resourceId, permId: perm.id, data: { permission: newPermission as PermissionLevel } });
      } else {
        await updateMutation.mutateAsync({ documentId: resourceId, permId: perm.id, data: { permission: newPermission as PermissionLevel } });
      }
      toast.success(t("documents.permissionUpdated"));
    } catch {
      // interceptor shows the backend error message
    }
  };

  const handleRevoke = async (perm: DocumentPermissionResponse) => {
    try {
      if (isFolder) {
        await revokeFolderPermMutation.mutateAsync({ folderId: resourceId, permId: perm.id });
      } else {
        await revokeMutation.mutateAsync({ documentId: resourceId, permId: perm.id });
      }
      toast.success(t("documents.permissionRevoked"));
    } catch {
      // interceptor shows the backend error message
    }
  };

  const getGranteeName = (perm: DocumentPermissionResponse) => {
    if (perm.user_id) return perm.user_name || perm.user_email || perm.user_id;
    if (perm.group_id) {
      return perm.group_name ?? groups.find((g) => g.id === perm.group_id)?.name ?? perm.group_id;
    }
    return "—";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {resourceType === "folder" ? t("documents.shareFolder") : t("documents.shareDocument")}
          </DialogTitle>
          <p className="text-muted-foreground text-sm break-words">{resourceName}</p>
        </DialogHeader>

        <Tabs defaultValue="group">
          <TabsList className="w-full">
            <TabsTrigger value="group" className="flex-1">
              <Users className="mr-1.5 h-3.5 w-3.5" />{t("documents.shareWithGroup")}
            </TabsTrigger>
            <TabsTrigger value="user" className="flex-1">
              <User className="mr-1.5 h-3.5 w-3.5" />{t("documents.shareWithUser")}
            </TabsTrigger>
          </TabsList>

          {/* Group tab */}
          <TabsContent value="group" className="mt-3 space-y-3">
            {availableGroups.length > 0 ? (
              <>
                <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <Checkbox id="select-all" checked={allGroupsSelected} onCheckedChange={toggleSelectAll} />
                  <label htmlFor="select-all" className="cursor-pointer text-sm font-medium select-none">
                    {t("documents.selectAllGroups", { count: availableGroups.length })}
                  </label>
                </div>
                <div className="max-h-52 overflow-y-auto rounded-md">
                  <div className="space-y-1 pr-2">
                    {availableGroups.map((group) => (
                      <div key={group.id} className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-3 py-1.5">
                        <Checkbox id={group.id} checked={selectedGroupIds.includes(group.id)} onCheckedChange={() => toggleGroup(group.id)} />
                        <label htmlFor={group.id} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm select-none">
                          <Users className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{group.name}</span>
                          <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
                            {t("documents.memberCount", { count: group.member_count })}
                          </span>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground px-1 text-sm">{t("documents.allGroupsShared")}</p>
            )}
            <div className="flex items-center gap-2">
              <Select value={groupPermission} onValueChange={(v) => setGroupPermission(v as PermissionLevel)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">{t("documents.viewer")}</SelectItem>
                  <SelectItem value="editor">{t("documents.editor")}</SelectItem>
                  <SelectItem value="manager">{t("documents.manager")}</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleShareGroups} disabled={selectedGroupIds.length === 0 || shareMutation.isPending} size="sm" className="flex-1">
                {t("common.share")}{selectedGroupIds.length > 0 && ` (${selectedGroupIds.length})`}
              </Button>
            </div>
          </TabsContent>

          {/* User tab */}
          <TabsContent value="user" className="mt-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 text-sm"
                placeholder={t("documents.searchUserPlaceholder")}
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
              />
              {searchLoading && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>

            <div className="max-h-52 overflow-y-auto rounded-md">
              <div className="space-y-1 pr-2">
                {filteredUsers.length === 0 && !searchLoading && debouncedQuery.length > 0 && (
                  <p className="text-muted-foreground px-1 text-sm">{t("documents.noUsersFound")}</p>
                )}
                {filteredUsers.map((user) => (
                  <div key={user.id} className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-3 py-1.5">
                    <Checkbox
                      id={`user-${user.id}`}
                      checked={selectedUsers.some((u) => u.id === user.id)}
                      onCheckedChange={() => toggleUser(user)}
                    />
                    <label htmlFor={`user-${user.id}`} className="flex min-w-0 flex-1 cursor-pointer flex-col select-none">
                      <span className="text-sm font-medium truncate">{user.full_name}</span>
                      <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedUsers.map((u) => (
                  <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {u.full_name}
                    <button onClick={() => toggleUser(u)} className="text-primary/60 hover:text-primary">×</button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Select value={userPermission} onValueChange={(v) => setUserPermission(v as PermissionLevel)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">{t("documents.viewer")}</SelectItem>
                  <SelectItem value="editor">{t("documents.editor")}</SelectItem>
                  <SelectItem value="manager">{t("documents.manager")}</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleShareUsers} disabled={selectedUsers.length === 0 || shareMutation.isPending} size="sm" className="flex-1">
                {t("common.share")}{selectedUsers.length > 0 && ` (${selectedUsers.length})`}
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* Existing shares */}
        <div className="mt-1 space-y-2">
          <h4 className="text-sm font-medium">{t("documents.sharedWith")}</h4>
          {permsLoading && <p className="text-muted-foreground text-sm">{t("common.loading")}</p>}
          {!permsLoading && permissions.length === 0 && (
            <p className="text-muted-foreground text-sm">{t("documents.notSharedYet")}</p>
          )}
          <div className="max-h-52 overflow-y-auto space-y-2">
          {permissions.map((perm) => (
            <div key={perm.id} className="flex items-center justify-between rounded-md border p-2">
              <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                {perm.user_id ? (
                  <User className="text-muted-foreground h-4 w-4 shrink-0" />
                ) : (
                  <Users className="text-muted-foreground h-4 w-4 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{getGranteeName(perm)}</p>
                  {perm.user_id && perm.user_email && (
                    <p className="text-xs text-muted-foreground truncate">{perm.user_email}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Select value={perm.permission} onValueChange={(val) => handleUpdate(perm, val)}>
                  <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">{t("documents.viewer")}</SelectItem>
                    <SelectItem value="editor">{t("documents.editor")}</SelectItem>
                    <SelectItem value="manager">{t("documents.manager")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRevoke(perm)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
