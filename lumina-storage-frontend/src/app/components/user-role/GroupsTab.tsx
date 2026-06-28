import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Edit, Trash2, Eye, Users, RefreshCw } from "lucide-react";
import type { GroupResponse } from "@/app/types/api";
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

interface GroupsTabProps {
  groups: GroupResponse[];
  groupsSearchInput: string;
  onSearchChange: (v: string) => void;
  groupsTypeFilter: string;
  onTypeFilterChange: (v: string) => void;
  groupsPage: number;
  groupsTotal: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onViewMembers: (group: GroupResponse) => void;
  onEditGroup?: (group: GroupResponse) => void;
  onDeleteGroup?: (groupId: string) => void;
}

export function GroupsTab({
  groups,
  groupsSearchInput,
  onSearchChange,
  groupsTypeFilter,
  onTypeFilterChange,
  groupsPage,
  groupsTotal,
  pageSize,
  onPageChange,
  onViewMembers,
  onEditGroup,
  onDeleteGroup,
}: GroupsTabProps) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(groupsTotal / pageSize));

  const columns = useMemo<DataTableColumn<GroupResponse>[]>(
    () => [
      {
        key: "stt",
        header: t("users.table.no"),
        type: "stt" as const,
        sttOffset: (groupsPage - 1) * pageSize,
        headerClassName: "w-12",
        cellClassName: "w-12",
      },
      {
        key: "name",
        header: t("users.groupsTab.tableName"),
        type: "text" as const,
        field: "name" as const,
        semiBold: true,
        cellClassName: "text-brand-600",
      },
      {
        key: "description",
        header: t("users.groupsTab.tableDescription"),
        type: "text" as const,
        field: (group: GroupResponse) => group.description || "—",
        truncate: 240,
        cellClassName: "text-gray-500 text-sm",
      },
      {
        key: "type",
        header: t("users.groupsTab.tableType"),
        type: "tag_one" as const,
        field: (group: GroupResponse) =>
          group.type === "auto"
            ? t("users.groupsTab.typeAuto")
            : t("users.groupsTab.typeManual"),
        colorField: (group: GroupResponse): TableColor =>
          group.type === "auto" ? "purple" : "gray",
        icon: undefined,
        render: (group: GroupResponse) => {
          const isAuto = group.type === "auto";
          const Icon = isAuto ? RefreshCw : Users;
          return (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${isAuto ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}`}
            >
              <Icon className="h-3 w-3" />
              {isAuto ? t("users.groupsTab.typeAuto") : t("users.groupsTab.typeManual")}
            </span>
          );
        },
      },
      {
        key: "members",
        header: t("users.groupsTab.tableMembers"),
        type: "number" as const,
        field: "member_count" as const,
      },
      {
        key: "actions",
        header: t("users.table.actions"),
        render: (group) => (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewMembers(group);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Eye className="h-3.5 w-3.5" /> {t("users.groupsTab.membersButton")}
            </button>
            {onEditGroup && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEditGroup?.(group);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <Edit className="h-3.5 w-3.5" /> {t("users.actions.edit")}
              </button>
            )}
            {onDeleteGroup && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteGroup?.(group.id);
                }}
                className="border-brand-300 text-brand-600 hover:bg-brand-50 inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" /> {t("users.actions.delete")}
              </button>
            )}
          </div>
        ),
      },
    ],
    [t, onViewMembers, onEditGroup, onDeleteGroup, groupsPage, pageSize]
  );

  return (
    <section className="space-y-4">
      <SearchFilterBar
        searchValue={groupsSearchInput}
        onSearchChange={onSearchChange}
        searchPlaceholder={t("users.groupsTab.searchPlaceholder")}
        filters={
          <Select
            value={groupsTypeFilter || "__all__"}
            onValueChange={(v) => onTypeFilterChange(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="h-9 w-[130px] text-sm">
              <SelectValue placeholder={t("users.groupsTab.allTypes")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("users.groupsTab.allTypes")}</SelectItem>
              <SelectItem value="manual">{t("users.groupsTab.typeManual")}</SelectItem>
              <SelectItem value="auto">{t("users.groupsTab.typeAuto")}</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {/* Desktop table */}
      <DataTable
        columns={columns}
        data={groups}
        rowKey={(group) => group.id}
        emptyMessage={t("users.groupsTab.empty")}
        className="hidden md:block"
        footer={
          <PaginationBar
            page={groupsPage}
            totalPages={totalPages}
            total={groupsTotal}
            pageSize={pageSize}
            onPageChange={onPageChange}
          />
        }
      />

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {groups.length > 0 ? (
          groups.map((group) => (
            <div
              key={group.id}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-brand-600 truncate text-base font-semibold">
                    {group.name}
                  </p>
                  {group.description && (
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {group.description}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-gray-500">
                    {t("users.groupsTab.memberCount", { count: group.member_count })}
                  </p>
                </div>
                {group.type === "auto" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-700">
                    <RefreshCw className="h-3 w-3" /> {t("users.groupsTab.typeAuto")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                    <Users className="h-3 w-3" /> {t("users.groupsTab.typeManual")}
                  </span>
                )}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                  onClick={() => onViewMembers(group)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <Eye className="h-4 w-4" /> {t("users.groupsTab.membersButton")}
                </button>
                {onEditGroup && (
                  <button
                    onClick={() => onEditGroup?.(group)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <Edit className="h-4 w-4" /> {t("users.actions.edit")}
                  </button>
                )}
                {onDeleteGroup && (
                  <button
                    onClick={() => onDeleteGroup?.(group.id)}
                    className="border-brand-300 text-brand-600 hover:bg-brand-50 inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
                  >
                    <Trash2 className="h-4 w-4" /> {t("users.actions.delete")}
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
            {t("users.groupsTab.empty")}
          </div>
        )}
        <PaginationBar
          page={groupsPage}
          totalPages={totalPages}
          total={groupsTotal}
          pageSize={pageSize}
          onPageChange={onPageChange}
        />
      </div>
    </section>
  );
}
