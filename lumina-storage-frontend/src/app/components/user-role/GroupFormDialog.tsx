import { useState, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/app/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import type {
  RoleResponse,
  GroupResponse,
  GroupDetailResponse,
} from "@/app/types/api";
import { groupsApi } from "@/app/api/endpoints/groups";
import { ManualUsersTable } from "./ManualUsersTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";

export interface GroupFormState {
  name: string;
  description: string;
  type: "manual" | "auto";
  is_select_all: boolean;
  filter_role_id: string;
  user_ids: string[];
  exclude_ids: string[];
}

interface GroupFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: GroupFormState) => void;
  group: GroupResponse | null;
  roles: RoleResponse[];
  isSaving: boolean;
  allRoles: { id: string; name: string }[];
  allGroups: { id: string; name: string; type: string }[];
}

export function GroupFormDialog({
  open,
  onClose,
  onSave,
  group,
  roles,
  isSaving,
  allRoles,
  allGroups,
}: GroupFormDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<GroupFormState>({
    name: group?.name ?? "",
    description: group?.description ?? "",
    type: group?.type ?? "manual",
    is_select_all: group?.is_select_all ?? false,
    filter_role_id: group?.filter_role_id ?? "",
    user_ids: [],
    exclude_ids: [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasInteracted, setHasInteracted] = useState(false);

  // Fetch group detail for edit mode (to get existing members)
  const { data: groupDetail } = useQuery({
    queryKey: ["groups", group?.id, "detail"],
    queryFn: () => groupsApi.get(group!.id),
    enabled: open && !!group,
  });

  const existingMemberIds = useMemo(
    () =>
      (groupDetail as GroupDetailResponse | undefined)?.members?.map(
        (m) => m.id
      ) ?? [],
    [groupDetail]
  );
  const existingMemberCount = group?.member_count ?? 0;

  // Reset form whenever dialog opens (new or different group)
  const [lastOpenKey, setLastOpenKey] = useState<string | null>(null);
  const openKey = open ? (group?.id ?? "__new__") : null;
  if (openKey !== null && openKey !== lastOpenKey) {
    setLastOpenKey(openKey);
    setErrors({});
    setHasInteracted(false);
    setForm({
      name: group?.name ?? "",
      description: group?.description ?? "",
      type: group?.type ?? "manual",
      is_select_all: group?.is_select_all ?? false,
      filter_role_id: group?.filter_role_id ?? "",
      user_ids: [],
      exclude_ids: [],
    });
  }
  if (!open && lastOpenKey !== null) {
    setLastOpenKey(null);
  }

  if (!open) return null;

  const handleToggleUser = (userId: string) => {
    if (!hasInteracted) {
      setHasInteracted(true);
      if (form.is_select_all) {
        setForm((f) => ({
          ...f,
          is_select_all: true,
          exclude_ids: [userId],
          user_ids: [],
        }));
      } else {
        const wasSelected = existingMemberIds.includes(userId);
        const newIds = wasSelected
          ? existingMemberIds.filter((id) => id !== userId)
          : [...existingMemberIds, userId];
        setForm((f) => ({ ...f, user_ids: newIds, exclude_ids: [] }));
      }
    } else {
      setForm((f) => {
        if (f.is_select_all) {
          const newExclude = f.exclude_ids.includes(userId)
            ? f.exclude_ids.filter((id) => id !== userId)
            : [...f.exclude_ids, userId];
          return { ...f, exclude_ids: newExclude };
        } else {
          const newIds = f.user_ids.includes(userId)
            ? f.user_ids.filter((id) => id !== userId)
            : [...f.user_ids, userId];
          return { ...f, user_ids: newIds };
        }
      });
    }
    setErrors((prev) => ({ ...prev, users: "" }));
  };

  const handleClearAll = () => {
    setHasInteracted(true);
    setForm((f) => ({
      ...f,
      is_select_all: false,
      user_ids: [],
      exclude_ids: [],
    }));
  };

  const handleSelectAll = () => {
    setHasInteracted(true);
    setForm((f) => ({
      ...f,
      is_select_all: true,
      user_ids: [],
      exclude_ids: [],
    }));
    setErrors((prev) => ({ ...prev, users: "" }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = t("users.groupFormDialog.fieldNameRequired");
    if (form.type === "manual") {
      if (
        !hasInteracted &&
        existingMemberIds.length === 0 &&
        !form.is_select_all
      ) {
        errs.users = t("users.groupFormDialog.selectAtLeastOneUser");
      } else if (
        hasInteracted &&
        !form.is_select_all &&
        form.user_ids.length === 0
      ) {
        errs.users = t("users.groupFormDialog.selectAtLeastOneUser");
      }
    }
    if (form.type === "auto" && !form.filter_role_id) {
      errs.filter_role_id = t("users.groupFormDialog.filterByRoleRequired");
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    if (group && !hasInteracted) {
      onSave({ ...form, user_ids: [], exclude_ids: [] });
    } else {
      onSave(form);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4 sm:px-6">
          <h2 className="text-lg font-semibold text-gray-900">
            {group ? t("users.groupFormDialog.titleEdit") : t("users.groupFormDialog.titleCreate")}
          </h2>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {t("users.groupFormDialog.fieldName")} <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={form.name}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, name: e.target.value }));
                    setErrors((prev) => ({ ...prev, name: "" }));
                  }}
                  className={`h-11 rounded-xl ${errors.name ? "border-red-500" : ""}`}
                  placeholder={t("users.groupFormDialog.fieldNamePlaceholder")}
                  autoFocus
                />
                {errors.name && (
                  <p className="mt-1 text-xs text-red-500">{errors.name}</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {t("users.groupFormDialog.fieldType")}
                </label>
                <div className="flex h-11 items-center gap-4">
                  {(["manual", "auto"] as const).map((groupType) => (
                    <label
                      key={groupType}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="radio"
                        name="group-type"
                        value={groupType}
                        checked={form.type === groupType}
                        onChange={() => {
                          setForm((f) => ({
                            ...f,
                            type: groupType,
                            user_ids: [],
                            exclude_ids: [],
                            is_select_all: false,
                            filter_role_id: "",
                          }));
                          setHasInteracted(false);
                        }}
                        className="text-brand-500 h-4 w-4"
                      />
                      {groupType === "manual" ? t("users.groupFormDialog.typeManual") : t("users.groupFormDialog.typeAuto")}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t("users.groupFormDialog.fieldDescription")}
              </label>
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                rows={2}
                className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:ring-1 focus:outline-none"
                placeholder={t("users.groupFormDialog.fieldDescriptionPlaceholder")}
              />
            </div>

            {form.type === "auto" ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {t("users.groupFormDialog.filterByRole")} <span className="text-red-500">*</span>
                </label>
                <Select
                  value={form.filter_role_id || "__none__"}
                  onValueChange={(v) => {
                    setForm((f) => ({
                      ...f,
                      filter_role_id: v === "__none__" ? "" : v,
                    }));
                    setErrors((prev) => ({ ...prev, filter_role_id: "" }));
                  }}
                >
                  <SelectTrigger
                    className={`h-11 w-full rounded-xl ${errors.filter_role_id ? "border-red-500" : ""}`}
                  >
                    <SelectValue placeholder={t("users.groupFormDialog.selectRole")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("users.groupFormDialog.selectRole")}</SelectItem>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.filter_role_id && (
                  <p className="mt-1 text-xs text-red-500">
                    {errors.filter_role_id}
                  </p>
                )}
              </div>
            ) : (
              <ManualUsersTable
                isSelectAll={form.is_select_all}
                selectedIds={form.user_ids}
                excludeIds={form.exclude_ids}
                onToggleUser={handleToggleUser}
                onClearAll={handleClearAll}
                onSelectAll={handleSelectAll}
                allRoles={allRoles}
                allGroups={allGroups}
                existingMemberIds={existingMemberIds}
                existingMemberCount={existingMemberCount}
                hasInteracted={hasInteracted}
                error={errors.users}
              />
            )}
          </div>

          <div className="border-t border-gray-200 bg-white px-4 py-4 sm:px-6">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t("users.groupFormDialog.cancel")}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="bg-brand-500 hover:bg-brand-600 inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {group ? t("users.groupFormDialog.saveChanges") : t("users.groupFormDialog.createGroup")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
