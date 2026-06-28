import { useState, useEffect } from "react";
import { Search, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/app/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { usersApi } from "@/app/api/endpoints/users";
import { MultiSelectDropdown } from "./MultiSelectDropdown";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";

interface UserPickerPanelProps {
  selectedIds: string[];
  onToggle: (userId: string) => void;
  allRoles: { id: string; name: string }[];
  allGroups: { id: string; name: string; type: string }[];
}

export function UserPickerPanel({
  selectedIds,
  onToggle,
  allRoles,
  allGroups,
}: UserPickerPanelProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [pickerPage, setPickerPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPickerPage(1);
  }, [debouncedSearch, roleFilter, groupFilter, statusFilter]);

  const PAGE_SIZE = 15;
  const { data, isLoading } = useQuery({
    queryKey: [
      "users-picker",
      { debouncedSearch, roleFilter, groupFilter, statusFilter, pickerPage },
    ],
    queryFn: () =>
      usersApi.list({
        page: pickerPage,
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

  const pageUsers = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 border-b border-gray-100 p-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("users.userPickerPanel.searchPlaceholder")}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <MultiSelectDropdown
          options={allRoles}
          selected={roleFilter}
          onToggle={(id) =>
            setRoleFilter((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
            )
          }
          placeholder={t("users.userPickerPanel.placeholderRoles")}
        />
        <MultiSelectDropdown
          options={allGroups}
          selected={groupFilter}
          onToggle={(id) =>
            setGroupFilter((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
            )
          }
          placeholder={t("users.userPickerPanel.placeholderGroups")}
        />
        <Select
          value={statusFilter || "__all__"}
          onValueChange={(v) => setStatusFilter(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="h-8 w-[120px] text-xs">
            <SelectValue placeholder={t("users.userPickerPanel.allStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("users.userPickerPanel.allStatus")}</SelectItem>
            <SelectItem value="active">{t("users.userPickerPanel.statusActive")}</SelectItem>
            <SelectItem value="inactive">{t("users.userPickerPanel.statusInactive")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* User list */}
      <div className="max-h-44 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-5">
            <Loader2 className="text-brand-500 h-5 w-5 animate-spin" />
          </div>
        ) : pageUsers.length === 0 ? (
          <p className="py-5 text-center text-xs text-gray-400">
            {t("users.userPickerPanel.noUsers")}
          </p>
        ) : (
          pageUsers.map((user) => {
            const checked = selectedIds.includes(user.id);
            return (
              <label
                key={user.id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(user.id)}
                  className="text-brand-500 accent-brand-500 h-4 w-4 rounded border-gray-300"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {user.full_name || user.username}
                  </p>
                  <p className="truncate text-xs text-gray-500">{user.email}</p>
                </div>
              </label>
            );
          })
        )}
      </div>

      {/* Footer: count + pagination */}
      <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
        <span className="text-xs text-gray-400">
          {t("users.userPickerPanel.selectedCount", { count: selectedIds.length })}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPickerPage((p) => Math.max(1, p - 1))}
              disabled={pickerPage <= 1}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <span className="text-xs text-gray-500">
              {pickerPage}/{totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPickerPage((p) => Math.min(totalPages, p + 1))}
              disabled={pickerPage >= totalPages}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
