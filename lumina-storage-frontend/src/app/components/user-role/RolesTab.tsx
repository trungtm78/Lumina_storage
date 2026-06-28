import { useMemo } from "react";
import { Edit, Trash2, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RoleResponse } from "@/app/types/api";
import { PaginationBar } from "./PaginationBar";
import {
  DataTable,
  type DataTableColumn,
} from "@/app/components/ui/data-table";
import { SearchFilterBar } from "@/app/components/ui/search-filter-bar";

interface RolesTabProps {
  roles: RoleResponse[];
  rolesSearchInput: string;
  onSearchChange: (v: string) => void;
  rolesPage: number;
  rolesTotal: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onViewRole: (role: RoleResponse) => void;
  onEditRole?: (role: RoleResponse) => void;
  onDeleteRole?: (roleId: string) => void;
}

export function RolesTab({
  roles,
  rolesSearchInput,
  onSearchChange,
  rolesPage,
  rolesTotal,
  pageSize,
  onPageChange,
  onViewRole,
  onEditRole,
  onDeleteRole,
}: RolesTabProps) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(rolesTotal / pageSize));

  const columns = useMemo<DataTableColumn<RoleResponse>[]>(
    () => [
      {
        key: "stt",
        header: t("users.rolesTab.colNo"),
        type: "stt" as const,
        sttOffset: (rolesPage - 1) * pageSize,
        headerClassName: "w-12",
        cellClassName: "w-12",
      },
      {
        key: "name",
        header: t("users.rolesTab.colName"),
        type: "text" as const,
        field: "name" as const,
        semiBold: true,
        cellClassName: "text-brand-600",
      },
      {
        key: "description",
        header: t("users.rolesTab.colDescription"),
        type: "text" as const,
        field: (role: RoleResponse) => role.description || "—",
        truncate: 280,
        cellClassName: "text-gray-500 text-sm",
      },
      {
        key: "actions",
        header: t("users.rolesTab.colActions"),
        render: (role) => (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewRole(role);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Eye className="h-3.5 w-3.5" /> {t("users.rolesTab.actionView")}
            </button>
            {onEditRole && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEditRole?.(role);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Edit className="h-3.5 w-3.5" /> {t("users.rolesTab.actionEdit")}
              </button>
            )}
            {onDeleteRole && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteRole?.(role.id);
                }}
                className="border-brand-300 text-brand-600 hover:bg-brand-50 inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" /> {t("users.rolesTab.actionDelete")}
              </button>
            )}
          </div>
        ),
      },
    ],
    [t, onViewRole, onEditRole, onDeleteRole, rolesPage, pageSize]
  );

  return (
    <section className="space-y-4">
      <SearchFilterBar
        searchValue={rolesSearchInput}
        onSearchChange={onSearchChange}
        searchPlaceholder={t("users.rolesTab.searchPlaceholder")}
      />

      {/* Desktop table */}
      <DataTable
        columns={columns}
        data={roles}
        rowKey={(role) => role.id}
        emptyMessage={t("users.rolesTab.empty")}
        className="hidden md:block"
        footer={
          <PaginationBar
            page={rolesPage}
            totalPages={totalPages}
            total={rolesTotal}
            pageSize={pageSize}
            onPageChange={onPageChange}
          />
        }
      />

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {roles.length > 0 ? (
          roles.map((role) => (
            <div
              key={role.id}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-brand-600 truncate text-base font-semibold">
                    {role.name}
                  </p>
                  {role.description && (
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {role.description}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-gray-500">ID: {role.id}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                  onClick={() => onViewRole(role)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <Eye className="h-4 w-4" /> {t("users.rolesTab.actionView")}
                </button>
                {onEditRole && (
                  <button
                    onClick={() => onEditRole?.(role)}
                    disabled={role.is_default}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Edit className="h-4 w-4" /> {t("users.rolesTab.actionEdit")}
                  </button>
                )}
                {onDeleteRole && (
                  <button
                    onClick={() => onDeleteRole?.(role.id)}
                    disabled={role.is_default}
                    className="border-brand-300 text-brand-600 hover:bg-brand-50 inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" /> {t("users.rolesTab.actionDelete")}
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
            {t("users.rolesTab.empty")}
          </div>
        )}
        <PaginationBar
          page={rolesPage}
          totalPages={totalPages}
          total={rolesTotal}
          pageSize={pageSize}
          onPageChange={onPageChange}
        />
      </div>
    </section>
  );
}
