import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { groupsApi } from "@/app/api/endpoints/groups";
import type { GroupMemberResponse, GroupResponse } from "@/app/types/api";
import {
  DataTable,
  type DataTableColumn,
  type TableColor,
} from "@/app/components/ui/data-table";
import { useDebounce } from "@/app/hooks/useDebounce";

const PAGE_SIZE = 20;

interface ViewGroupMembersDialogProps {
  open: boolean;
  onClose: () => void;
  group: GroupResponse | null;
}

function buildColumns(
  pageOffset: number,
  t: TFunction
): DataTableColumn<GroupMemberResponse>[] {
  return [
    {
      key: "stt",
      header: t("users.viewGroupMembersDialog.colNo"),
      type: "stt",
      sttOffset: pageOffset,
      headerClassName: "w-12",
      cellClassName: "w-12",
    },
    {
      key: "username",
      header: t("users.viewGroupMembersDialog.colUsername"),
      type: "text",
      field: "username",
      semiBold: true,
      cellClassName: "text-brand-600",
    },
    {
      key: "name",
      header: t("users.viewGroupMembersDialog.colName"),
      type: "text",
      field: "full_name",
      truncate: 150,
    },
    {
      key: "email",
      header: t("users.viewGroupMembersDialog.colEmail"),
      type: "text",
      field: "email",
      truncate: 200,
    },
    {
      key: "role",
      header: t("users.viewGroupMembersDialog.colRole"),
      type: "text",
      field: (m) => m.role?.name ?? "—",
    },
    {
      key: "status",
      header: t("users.viewGroupMembersDialog.colStatus"),
      type: "status",
      field: (m) => (m.is_active ? t("users.viewGroupMembersDialog.statusActive") : t("users.viewGroupMembersDialog.statusInactive")),
      colorField: (m): TableColor => (m.is_active ? "green" : "gray"),
    },
  ];
}

export function ViewGroupMembersDialog({
  open,
  onClose,
  group,
}: ViewGroupMembersDialogProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: [
      "groups",
      group?.id,
      "members",
      { page, search: debouncedSearch },
    ],
    queryFn: () =>
      groupsApi.getMembers(group!.id, {
        page,
        page_size: PAGE_SIZE,
        search: debouncedSearch || undefined,
      }),
    enabled: open && !!group,
  });

  const members: GroupMemberResponse[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset page when search changes
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  if (!open || !group) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-200 px-4 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">
                {group.name}
              </h2>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  group.type === "auto"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-purple-100 text-purple-700"
                }`}
              >
                {group.type === "auto" ? t("users.viewGroupMembersDialog.typeAuto") : t("users.viewGroupMembersDialog.typeManual")}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-gray-500">{t("users.viewGroupMembersDialog.membersCount", { count: total })}</p>
            {group.description && (
              <p className="mt-1 text-sm text-gray-500">{group.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-gray-100 px-4 py-3 sm:px-6">
          <div className="relative">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t("users.viewGroupMembersDialog.searchPlaceholder")}
              className="focus:border-brand-300 focus:ring-brand-300 h-9 w-full rounded-lg border border-gray-200 bg-gray-50 pr-4 pl-9 text-sm focus:ring-1 focus:outline-none"
            />
          </div>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <DataTable
            columns={buildColumns((page - 1) * PAGE_SIZE, t)}
            data={members}
            rowKey={(m) => m.id}
            isLoading={isLoading}
            emptyMessage={t("users.viewGroupMembersDialog.noMembers")}
            className="rounded-xl"
          />
        </div>

        {/* Pagination + Close */}
        <div className="border-t border-gray-200 bg-white px-4 py-3 sm:px-6">
          {totalPages > 1 && (
            <div className="mb-3 flex items-center justify-between text-sm text-gray-600">
              <span>
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}{" "}
                of {total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-gray-100 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-2">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-gray-100 disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
          <button
            onClick={onClose}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t("users.viewGroupMembersDialog.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
