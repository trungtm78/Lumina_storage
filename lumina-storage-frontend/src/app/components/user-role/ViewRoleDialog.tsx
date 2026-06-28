import { useMemo } from "react";
import { X, Users, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { RoleResponse, UserResponse } from "@/app/types/api";
import { rolesApi, permissionsApi } from "@/app/api/endpoints/users";
import { useTranslation } from "react-i18next";

const LEVEL_STYLES: Record<number, string> = {
  0: "bg-gray-100 text-gray-500",
  1: "bg-blue-100 text-blue-700",
  2: "bg-green-100 text-green-700",
};

interface ViewRoleDialogProps {
  open: boolean;
  onClose: () => void;
  role: RoleResponse | null;
  users: UserResponse[];
}

export function ViewRoleDialog({
  open,
  onClose,
  role,
  users,
}: ViewRoleDialogProps) {
  const { t } = useTranslation();

  const LEVEL_LABELS = useMemo<Record<number, string>>(
    () => ({
      0: t("users.viewRoleDialog.levelNone"),
      1: t("users.viewRoleDialog.levelView"),
      2: t("users.viewRoleDialog.levelEdit"),
    }),
    [t]
  );

  const { data: roleMenuPerms } = useQuery({
    queryKey: ["roles", role?.id, "menu-permissions"],
    queryFn: () => rolesApi.getMenuPermissions(role!.id),
    enabled: open && !!role,
  });

  const { data: allMenuPerms } = useQuery({
    queryKey: ["permissions", "menu"],
    queryFn: () => permissionsApi.listMenuPermissions(),
    enabled: open,
  });

  if (!open || !role) return null;

  const members = users.filter((u) => u.role?.id === role.id);

  const levelMap = Object.fromEntries(
    (roleMenuPerms ?? []).map((p) => [p.menu_permission_id, p.level])
  );
  const permItems = (allMenuPerms ?? []).map((mp) => ({
    menu_permission_id: mp.id,
    name: mp.name,
    level: levelMap[mp.id] ?? 0,
  }));
  const activePerms = permItems.filter((item) => item.level > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900 sm:text-xl">
                {role.name}
              </h2>
              <span className="bg-brand-500 rounded-md px-2 py-0.5 text-xs text-white">
                ID: {role.id}
              </span>
            </div>
            {role.description && (
              <p className="mt-1 text-sm text-gray-500">{role.description}</p>
            )}
          </div>

          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
          {/* Members */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">
                {t("users.viewRoleDialog.sectionMembers")} ({members.length})
              </h3>
            </div>

            {members.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                {t("users.viewRoleDialog.noMembers")}
              </div>
            ) : (
              <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                {members.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="bg-brand-500 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium text-white">
                      {user.full_name?.[0]?.toUpperCase() ??
                        user.username[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {user.full_name || user.username}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {user.email}
                      </p>
                    </div>
                    <span
                      className={`ml-auto inline-flex flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.is_active
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {user.is_active ? t("users.viewRoleDialog.userActive") : t("users.viewRoleDialog.userInactive")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Menu Permissions (read-only) */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">
                {t("users.viewRoleDialog.sectionMenuPermissions")}
              </h3>
            </div>

            {permItems.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                {t("users.viewRoleDialog.noMenuPermissions")}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-200">
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">
                        {t("users.viewRoleDialog.colMenuItem")}
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold tracking-wide text-gray-600 uppercase">
                        {t("users.viewRoleDialog.colAccessLevel")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {permItems.map((item) => (
                      <tr
                        key={item.menu_permission_id}
                        className={item.level === 0 ? "opacity-50" : ""}
                      >
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {item.name}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              LEVEL_STYLES[item.level] ?? LEVEL_STYLES[0]
                            }`}
                          >
                            {LEVEL_LABELS[item.level] ?? "None"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activePerms.length === 0 && permItems.length > 0 && (
              <p className="mt-2 text-xs text-gray-400">
                {t("users.viewRoleDialog.allNoneNote")}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 bg-white px-4 py-4 sm:px-6">
          <button
            onClick={onClose}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-gray-300 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            {t("users.viewRoleDialog.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
