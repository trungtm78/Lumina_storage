import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Edit, Trash2, Link as LinkIcon, UserX } from "lucide-react";
import type {
  UserResponse,
  RoleResponse,
  GroupResponse,
} from "@/app/types/api";
import { MultiSelectDropdown } from "./MultiSelectDropdown";
import { PaginationBar } from "./PaginationBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  DataTable,
  type DataTableColumn,
  type TableColor,
} from "@/app/components/ui/data-table";
import { SearchFilterBar } from "@/app/components/ui/search-filter-bar";

interface UsersTabProps {
  users: UserResponse[];
  usersLoading: boolean;
  usersSearchInput: string;
  onSearchChange: (v: string) => void;
  allRoles: RoleResponse[];
  allGroups: GroupResponse[];
  usersRoleFilter: string[];
  onRoleFilterToggle: (id: string) => void;
  usersGroupFilter: string[];
  onGroupFilterToggle: (id: string) => void;
  usersStatusFilter: string;
  onStatusFilterChange: (v: string) => void;
  usersPage: number;
  usersTotal: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onEditUser?: (user: UserResponse) => void;
  onDeleteUser?: (userId: string) => void;
  onHardDeleteUser?: (userId: string) => void;
}

export function UsersTab({
  users,
  usersLoading,
  usersSearchInput,
  onSearchChange,
  allRoles,
  allGroups,
  usersRoleFilter,
  onRoleFilterToggle,
  usersGroupFilter,
  onGroupFilterToggle,
  usersStatusFilter,
  onStatusFilterChange,
  usersPage,
  usersTotal,
  pageSize,
  onPageChange,
  onEditUser,
  onDeleteUser,
  onHardDeleteUser,
}: UsersTabProps) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(usersTotal / pageSize));

  const sttOffset = (usersPage - 1) * pageSize;

  const columns = useMemo<DataTableColumn<UserResponse>[]>(
    () => [
      {
        key: "stt",
        header: t("users.table.no"),
        type: "stt" as const,
        sttOffset,
        headerClassName: "w-12",
        cellClassName: "w-12",
      },
      {
        key: "username",
        header: t("users.username"),
        type: "link" as const,
        field: (user: UserResponse) => user.username,
        semiBold: true,
      },
      {
        key: "name",
        header: t("users.fullName"),
        type: "text" as const,
        field: (user: UserResponse) => user.full_name || "—",
        truncate: 200,
      },
      {
        key: "email",
        header: t("users.email"),
        type: "text" as const,
        field: "email" as const,
        truncate: 220,
      },
      {
        key: "role",
        header: t("users.role"),
        type: "text" as const,
        field: (user: UserResponse) => user?.role?.name ?? "—",
        truncate: 180,
      },
      {
        key: "groups",
        header: t("users.groups"),
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
        header: t("users.table.status"),
        type: "status" as const,
        field: (user: UserResponse) =>
          user.is_active ? t("users.active") : t("users.inactive"),
        colorField: (user: UserResponse): TableColor =>
          user.is_active ? "green" : "gray",
      },
      ...(onEditUser || onDeleteUser || onHardDeleteUser
        ? [
            {
              key: "actions" as const,
              header: t("users.table.actions"),
              render: (user: UserResponse) => (
                <div className="flex flex-wrap items-center gap-2">
                  {onEditUser && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditUser?.(user);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <Edit className="h-3.5 w-3.5" /> {t("users.actions.edit")}
                    </button>
                  )}
                  {user.is_active
                    ? onDeleteUser && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteUser?.(user.id);
                          }}
                          className="border-brand-300 text-brand-600 hover:bg-brand-50 inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm transition-colors"
                        >
                          <UserX className="h-3.5 w-3.5" /> {t("users.deactivate")}
                        </button>
                      )
                    : onHardDeleteUser && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onHardDeleteUser?.(user.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> {t("users.actions.delete")}
                        </button>
                      )}
                </div>
              ),
            },
          ]
        : []),
    ],
    [t, onEditUser, onDeleteUser, onHardDeleteUser, sttOffset]
  );

  return (
    <section className="space-y-4">
      <SearchFilterBar
        searchValue={usersSearchInput}
        onSearchChange={onSearchChange}
        searchPlaceholder={t("users.search.users")}
        filters={
          <>
            <MultiSelectDropdown
              options={allRoles}
              selected={usersRoleFilter}
              onToggle={onRoleFilterToggle}
              placeholder={t("users.filter.allRoles")}
            />
            <MultiSelectDropdown
              options={allGroups}
              selected={usersGroupFilter}
              onToggle={onGroupFilterToggle}
              placeholder={t("users.filter.allGroups")}
            />
            <Select
              value={usersStatusFilter || "__all__"}
              onValueChange={(v) =>
                onStatusFilterChange(v === "__all__" ? "" : v)
              }
            >
              <SelectTrigger className="h-9 w-[130px] text-sm">
                <SelectValue placeholder={t("users.filter.allStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("users.filter.allStatus")}</SelectItem>
                <SelectItem value="active">{t("users.active")}</SelectItem>
                <SelectItem value="inactive">{t("users.inactive")}</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      {/* Desktop table */}
      <DataTable
        columns={columns}
        data={users}
        rowKey={(user) => user.id}
        isLoading={usersLoading}
        emptyMessage={t("users.empty.users")}
        className="hidden md:block"
        footer={
          <PaginationBar
            page={usersPage}
            totalPages={totalPages}
            total={usersTotal}
            pageSize={pageSize}
            onPageChange={onPageChange}
          />
        }
      />

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {usersLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </div>
        ) : users.length > 0 ? (
          users.map((user) => (
            <div
              key={user.id}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-gray-900">
                    {user.full_name || "—"}
                  </p>
                  <p className="text-brand-600 truncate text-sm">
                    @{user.username}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${user.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}
                >
                  {user.is_active ? t("users.active") : t("users.inactive")}
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-500">{t("users.email")}: </span>
                  <span className="break-all text-gray-900">{user.email}</span>
                </div>
                <div>
                  <span className="text-gray-500">{t("users.role")}: </span>
                  <span className="text-gray-900">
                    {user?.role?.name ?? "—"}
                  </span>
                </div>
                {user.groups && user.groups.length > 0 && (
                  <div>
                    <span className="text-gray-500">{t("users.groups")}: </span>
                    <span className="inline-flex flex-wrap gap-1">
                      {user.groups.map((g) => (
                        <span
                          key={g.id}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            g.type === "auto"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {g.type === "auto" && (
                            <LinkIcon className="h-2.5 w-2.5" />
                          )}
                          {g.name}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>
              {(onEditUser || onDeleteUser || onHardDeleteUser) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {onEditUser && (
                    <button
                      onClick={() => onEditUser?.(user)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <Edit className="h-4 w-4" /> {t("users.actions.edit")}
                    </button>
                  )}
                  {user.is_active
                    ? onDeleteUser && (
                        <button
                          onClick={() => onDeleteUser?.(user.id)}
                          className="border-brand-300 text-brand-600 hover:bg-brand-50 inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
                        >
                          <UserX className="h-4 w-4" /> {t("users.deactivate")}
                        </button>
                      )
                    : onHardDeleteUser && (
                        <button
                          onClick={() => onHardDeleteUser?.(user.id)}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" /> {t("users.actions.delete")}
                        </button>
                      )}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
            {t("users.empty.users")}
          </div>
        )}
        <PaginationBar
          page={usersPage}
          totalPages={totalPages}
          total={usersTotal}
          pageSize={pageSize}
          onPageChange={onPageChange}
        />
      </div>
    </section>
  );
}
