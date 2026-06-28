import { useState, useEffect, useMemo } from "react";
import { X, Loader2 } from "lucide-react";
import { Input } from "@/app/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { rolesApi, permissionsApi } from "@/app/api/endpoints/users";
import { useTranslation } from "react-i18next";

interface EditRoleDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (roleData: {
    name: string;
    description: string;
    menuPermissions: { menu_permission_id: number; level: number }[];
  }) => void;
  role: { id: string; name: string; description?: string | null } | null;
}

export function EditRoleDialog({
  open,
  onClose,
  onSave,
  role,
}: EditRoleDialogProps) {
  const { t } = useTranslation();

  const LEVELS = useMemo(
    () => [
      { value: 0, label: t("users.editRoleDialog.levelNone") },
      { value: 1, label: t("users.editRoleDialog.levelView") },
      { value: 2, label: t("users.editRoleDialog.levelEdit") },
    ] as const,
    [t]
  );

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [description, setDescription] = useState("");
  const [permLevels, setPermLevels] = useState<Record<number, 0 | 1 | 2>>({});

  const { data: menuPermissions, isLoading: menuPermsLoading } = useQuery({
    queryKey: ["permissions", "menu"],
    queryFn: () => permissionsApi.listMenuPermissions(),
    enabled: open,
  });

  const { data: roleMenuPerms, isLoading: roleMenuPermsLoading } = useQuery({
    queryKey: ["roles", role?.id, "menu-permissions"],
    queryFn: () => rolesApi.getMenuPermissions(role!.id),
    enabled: open && !!role,
  });

  useEffect(() => {
    if (open) {
      setName(role?.name ?? "");
      setDescription(role?.description ?? "");
      setNameError("");
    }
  }, [open, role]);

  // Find locked menu permission ids
  const documentsMenuPermId = menuPermissions?.find(
    (mp) => mp.urlpath === "/documents"
  )?.id;
  const chatMenuPermId = menuPermissions?.find(
    (mp) => mp.urlpath === "/chat"
  )?.id;

  useEffect(() => {
    if (roleMenuPerms) {
      const levels: Record<number, 0 | 1 | 2> = {};
      for (const item of roleMenuPerms) {
        levels[item.menu_permission_id] = item.level as 0 | 1 | 2;
      }
      // Ensure Documents is at least View (1)
      if (
        documentsMenuPermId != null &&
        (levels[documentsMenuPermId] ?? 0) < 1
      ) {
        levels[documentsMenuPermId] = 1;
      }
      // Ensure Chat AI is always Edit (2)
      if (chatMenuPermId != null) {
        levels[chatMenuPermId] = 2;
      }
      setPermLevels(levels);
    } else if (open && !role) {
      const defaults: Record<number, 0 | 1 | 2> = {};
      if (documentsMenuPermId != null) defaults[documentsMenuPermId] = 1;
      if (chatMenuPermId != null) defaults[chatMenuPermId] = 2;
      setPermLevels(defaults);
    }
  }, [roleMenuPerms, open, role, documentsMenuPermId, chatMenuPermId]);

  const isLoading = menuPermsLoading || (!!role && roleMenuPermsLoading);

  const setLevel = (menuPermId: number, level: 0 | 1 | 2) => {
    setPermLevels((prev) => ({ ...prev, [menuPermId]: level }));
  };

  const getLevel = (menuPermId: number): 0 | 1 | 2 =>
    permLevels[menuPermId] ?? 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(t("users.editRoleDialog.fieldNameRequired"));
      return;
    }
    const menuPermissionsPayload = (menuPermissions ?? []).map((mp) => ({
      menu_permission_id: mp.id,
      level:
        mp.urlpath === "/chat"
          ? 2 // Chat AI always Edit
          : mp.urlpath === "/documents"
            ? Math.max(getLevel(mp.id), 1) // Documents at least View
            : getLevel(mp.id),
    }));
    onSave({
      name: name.trim(),
      description: description.trim(),
      menuPermissions: menuPermissionsPayload,
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900 sm:text-xl">
                {role ? t("users.editRoleDialog.titleEdit") : t("users.editRoleDialog.titleCreate")}
              </h2>
              {role && (
                <span className="bg-brand-500 rounded-md px-2 py-0.5 text-xs text-white">
                  ID: {role.id}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {t("users.editRoleDialog.subtitle")}
            </p>
          </div>

          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
            {/* Name field */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("users.editRoleDialog.fieldName")} <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError("");
                }}
                className={`h-11 rounded-xl ${nameError ? "border-red-500" : ""}`}
                placeholder={t("users.editRoleDialog.fieldNamePlaceholder")}
                autoFocus
              />
              {nameError && (
                <p className="mt-1 text-xs text-red-500">{nameError}</p>
              )}
            </div>

            {/* Description field */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("users.editRoleDialog.fieldDescription")}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:ring-1 focus:outline-none"
                placeholder={t("users.editRoleDialog.fieldDescriptionPlaceholder")}
              />
            </div>

            {/* Menu permissions matrix */}
            <div>
              <label className="mb-3 block text-sm font-medium text-gray-700">
                {t("users.editRoleDialog.menuPermissions")}
              </label>

              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="text-brand-500 h-6 w-6 animate-spin" />
                </div>
              ) : menuPermissions && menuPermissions.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">
                          {t("users.editRoleDialog.colMenuItem")}
                        </th>
                        {LEVELS.map((lvl) => (
                          <th
                            key={lvl.value}
                            className="px-4 py-3 text-center text-xs font-semibold tracking-wide text-gray-600 uppercase"
                          >
                            {lvl.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {menuPermissions.map((mp) => {
                        const isDocuments = mp.urlpath === "/documents";
                        const isChat = mp.urlpath === "/chat";
                        return (
                          <tr key={mp.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {mp.name}
                            </td>
                            {LEVELS.map((lvl) => {
                              const isDisabled =
                                (isDocuments && lvl.value === 0) ||
                                (isChat && lvl.value < 2);
                              return (
                                <td
                                  key={lvl.value}
                                  className="px-4 py-3 text-center"
                                >
                                  <input
                                    type="radio"
                                    name={`menu-perm-${mp.id}`}
                                    checked={getLevel(mp.id) === lvl.value}
                                    onChange={() =>
                                      setLevel(mp.id, lvl.value as 0 | 1 | 2)
                                    }
                                    disabled={isDisabled}
                                    className={`text-brand-500 focus:ring-brand-500 h-4 w-4 border-gray-300 ${isDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                  {t("users.editRoleDialog.noPermissions")}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 bg-white px-4 py-4 sm:px-6">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-300 px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                {t("users.editRoleDialog.cancel")}
              </button>
              <button
                type="submit"
                className="bg-brand-500 hover:bg-brand-600 inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-medium text-white transition-colors"
              >
                {role ? t("users.editRoleDialog.saveChanges") : t("users.editRoleDialog.createRole")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
