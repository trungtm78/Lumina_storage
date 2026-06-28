import { useState, useEffect, useMemo, useCallback } from "react";
import { Link as LinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { UserResponse } from "@/app/types/api";
import { usersApi } from "@/app/api/endpoints/users";
import { MultiSelectDropdown } from "./MultiSelectDropdown";
import { PaginationBar } from "@/app/components/ui/pagination-bar";
import {
  DataTable,
  type DataTableColumn,
  type TableColor,
} from "@/app/components/ui/data-table";
import { SearchFilterBar } from "@/app/components/ui/search-filter-bar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";

const PAGE_SIZE = 10;

interface ManualUsersTableProps {
  isSelectAll: boolean;
  selectedIds: string[];
  excludeIds: string[];
  onToggleUser: (userId: string) => void;
  onClearAll: () => void;
  /** Called when header checkbox selects all — sets is_select_all=true across all pages */
  onSelectAll: () => void;
  allRoles: { id: string; name: string }[];
  allGroups: { id: string; name: string; type: string }[];
  /** Member IDs from group detail (edit mode) — used for pre-checking */
  existingMemberIds: string[];
  /** Total member count from group detail (edit mode) */
  existingMemberCount: number;
  /** Whether user has interacted with checkboxes */
  hasInteracted: boolean;
  error?: string;
}

export function ManualUsersTable({
  isSelectAll,
  selectedIds,
  excludeIds,
  onToggleUser,
  onClearAll,
  onSelectAll,
  allRoles,
  allGroups,
  existingMemberIds,
  existingMemberCount,
  hasInteracted,
  error,
}: ManualUsersTableProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [roleFilter, groupFilter, statusFilter]);

  const { data, isLoading } = useQuery({
    queryKey: [
      "users-group-picker",
      { debouncedSearch, roleFilter, groupFilter, statusFilter, page },
    ],
    queryFn: () =>
      usersApi.list({
        page,
        page_size: PAGE_SIZE,
        search: debouncedSearch || undefined,
        role_id: roleFilter.length > 0 ? roleFilter : undefined,
        group_id: groupFilter.length > 0 ? groupFilter : undefined,
        is_active:
          statusFilter === "active"
            ? true
            : statusFilter === "inactive"
              ? false
              : undefined,
      }),
  });

  const users = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Determine if a user is checked
  const isChecked = useCallback(
    (userId: string) => {
      if (!hasInteracted) {
        // Even if is_select_all=true from API, only check users actually in members[]
        // so header checkbox shows indeterminate when members.length < total
        return existingMemberIds.includes(userId);
      }
      if (isSelectAll) return !excludeIds.includes(userId);
      return selectedIds.includes(userId);
    },
    [hasInteracted, existingMemberIds, isSelectAll, excludeIds, selectedIds]
  );

  // Build selectedKeys Set from current page for DataTable checkbox
  const selectedKeys = useMemo(() => {
    const keys = new Set<string>();
    users.forEach((u) => {
      if (isChecked(u.id)) keys.add(u.id);
    });
    return keys;
  }, [users, isChecked]);

  console.log("selectedKeys", selectedKeys);

  const handleSelectedKeysChange = useCallback(
    (newKeys: Set<string>) => {
      const allPageIds = users.map((u) => u.id);
      const wasAllChecked = allPageIds.every((id) => selectedKeys.has(id));
      const nowAllChecked = allPageIds.every((id) => newKeys.has(id));
      const nowAllUnchecked = allPageIds.every((id) => !newKeys.has(id));

      // Header checkbox: all unchecked → all checked → select all across all pages
      if (!wasAllChecked && nowAllChecked) {
        onSelectAll();
        return;
      }

      // Header checkbox: all checked → all unchecked → clear all
      if (wasAllChecked && nowAllUnchecked) {
        onClearAll();
        return;
      }

      // Individual row toggle
      for (const id of allPageIds) {
        const wasSel = selectedKeys.has(id);
        const nowSel = newKeys.has(id);
        if (wasSel !== nowSel) {
          onToggleUser(id);
        }
      }
    },
    [users, selectedKeys, onClearAll, onSelectAll, onToggleUser]
  );

  // Global "all selected" state for header checkbox override:
  // - Before interaction: fully checked only if members[] covers all users
  // - After interaction: fully checked only if isSelectAll with no exclusions
  const isAllGloballySelected = useMemo(() => {
    if (!hasInteracted) {
      return existingMemberIds.length >= total && total > 0;
    }
    if (isSelectAll) return excludeIds.length === 0;
    return selectedIds.length >= total && total > 0;
  }, [
    hasInteracted,
    existingMemberIds.length,
    total,
    isSelectAll,
    excludeIds.length,
    selectedIds.length,
  ]);

  const sttOffset = (page - 1) * PAGE_SIZE;

  const columns: DataTableColumn<UserResponse>[] = useMemo(() => [
    {
      key: "checkbox",
      header: "",
      type: "checkbox",
      headerClassName: "w-10",
      cellClassName: "w-10",
    },
    {
      key: "stt",
      header: t("users.manualUsersTable.colNo"),
      type: "stt" as const,
      sttOffset,
      headerClassName: "w-12",
      cellClassName: "w-12",
    },
    {
      key: "username",
      header: t("users.manualUsersTable.colUsername"),
      type: "text" as const,
      field: (user: UserResponse) => user.username,
      semiBold: true,
      cellClassName: "text-brand-600",
    },
    {
      key: "name",
      header: t("users.manualUsersTable.colName"),
      type: "text" as const,
      field: (user: UserResponse) => user.full_name || "—",
      truncate: 150,
    },
    {
      key: "email",
      header: t("users.manualUsersTable.colEmail"),
      type: "text" as const,
      field: "email" as const,
      truncate: 180,
    },
    {
      key: "roles",
      header: t("users.manualUsersTable.colRoles"),
      type: "text" as const,
      field: (user: UserResponse) => user?.role?.name ?? "—",
      truncate: 120,
    },
    {
      key: "groups",
      header: t("users.manualUsersTable.colGroups"),
      type: "tag_multiple" as const,
      tagMapper: (user: UserResponse) =>
        (user.groups ?? []).map((g) => ({
          label: g.name,
          color: (g.type === "auto" ? "blue" : "gray") as TableColor,
          icon: g.type === "auto" ? LinkIcon : undefined,
        })),
    },
    {
      key: "status",
      header: t("users.manualUsersTable.colStatus"),
      type: "status" as const,
      field: (user: UserResponse) => (user.is_active ? t("users.manualUsersTable.statusActive") : t("users.manualUsersTable.statusInactive")),
      colorField: (user: UserResponse): TableColor =>
        user.is_active ? "green" : "gray",
    },
  ], [t, sttOffset]);

  // Selection count display
  const selectionCount = !hasInteracted
    ? existingMemberCount
    : isSelectAll
      ? total - excludeIds.length
      : selectedIds.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">
          {t("users.manualUsersTable.labelMembers")} <span className="text-red-500">*</span>
          {selectionCount > 0 && (
            <span className="bg-brand-100 text-brand-700 ml-2 rounded-full px-2 py-0.5 text-xs">
              {t("users.manualUsersTable.selectedCount", { count: selectionCount })}
            </span>
          )}
        </label>
      </div>

      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("users.manualUsersTable.searchPlaceholder")}
        filters={
          <>
            <MultiSelectDropdown
              options={allRoles}
              selected={roleFilter}
              onToggle={(id) =>
                setRoleFilter((prev) =>
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id]
                )
              }
              placeholder={t("users.manualUsersTable.allRoles")}
            />
            <MultiSelectDropdown
              options={allGroups}
              selected={groupFilter}
              onToggle={(id) =>
                setGroupFilter((prev) =>
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id]
                )
              }
              placeholder={t("users.manualUsersTable.allGroups")}
            />
            <Select
              value={statusFilter || "__all__"}
              onValueChange={(v) => setStatusFilter(v === "__all__" ? "" : v)}
            >
              <SelectTrigger className="h-9 w-[130px] text-sm">
                <SelectValue placeholder={t("users.manualUsersTable.allStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("users.manualUsersTable.allStatus")}</SelectItem>
                <SelectItem value="active">{t("users.manualUsersTable.statusActive")}</SelectItem>
                <SelectItem value="inactive">{t("users.manualUsersTable.statusInactive")}</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      <DataTable
        columns={columns}
        data={users}
        rowKey={(user) => user.id}
        isLoading={isLoading}
        emptyMessage={t("users.manualUsersTable.noUsers")}
        className="rounded-xl"
        selectedKeys={selectedKeys}
        onSelectedKeysChange={handleSelectedKeysChange}
        isAllSelectedOverride={isAllGloballySelected}
        footer={
          <PaginationBar
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        }
      />

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
