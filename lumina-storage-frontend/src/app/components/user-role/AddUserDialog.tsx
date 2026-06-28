import { useState, useEffect } from "react";
import { X, Link, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PasswordInput } from "@/app/components/password-input";
import { rolesApi } from "@/app/api/endpoints/users";
import type { UserResponse } from "@/app/types/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Input } from "@/app/components/ui/input";

interface AddUserPayload {
  username: string;
  email: string;
  password: string;
  fullName: string;
  roleId: string;
  manualGroupIds: string[];
}

interface EditUserPayload {
  fullName: string;
  email: string;
  isActive: boolean;
  // isSuperuser: boolean;
  roleId: string;
}

interface AddUserDialogProps {
  open: boolean;
  onClose: () => void;
  onAddUser: (payload: AddUserPayload) => void;
  onEditUser?: (userId: string, payload: EditUserPayload) => void;
  availableRoles: { id: string; name: string }[];
  availableGroups: {
    id: string;
    name: string;
    type: "manual" | "auto";
    filter_role_id?: string | null;
  }[];
  user?: UserResponse | null;
}

export function AddUserDialog({
  open,
  onClose,
  onAddUser,
  onEditUser,
  availableRoles,
  availableGroups,
  user,
}: AddUserDialogProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isActive, setIsActive] = useState(true);
  // const [isSuperuser, setIsSuperuser] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [roleLockedByGroup, setRoleLockedByGroup] = useState(false);
  const [lockedAutoGroupName, setLockedAutoGroupName] = useState<string | null>(
    null
  );
  const [selectedManualGroupIds, setSelectedManualGroupIds] = useState<
    string[]
  >([]);

  const isCreating = !user;

  // Fetch auto group for selected role (only when role was chosen first, not via auto group select)
  const { data: fetchedAutoGroup } = useQuery({
    queryKey: ["roles", selectedRoleId, "auto-group"],
    queryFn: () => rolesApi.getAutoGroup(selectedRoleId),
    enabled: isCreating && !!selectedRoleId && !roleLockedByGroup,
  });

  // Resolved auto group to display
  const linkedAutoGroup = roleLockedByGroup
    ? lockedAutoGroupName
      ? { name: lockedAutoGroupName }
      : null
    : (fetchedAutoGroup ?? null);

  useEffect(() => {
    if (open) {
      setErrors({});
      if (user) {
        setUsername(user.username);
        setEmail(user.email);
        setPassword("");
        setFullName(user.full_name);
        setIsActive(user.is_active);
        // setIsSuperuser(user.is_superuser);
        setSelectedRoleId(user?.role?.id ?? "");
        setRoleLockedByGroup(false);
        setLockedAutoGroupName(null);
        setSelectedManualGroupIds([]);
      } else {
        setUsername("");
        setEmail("");
        setPassword("");
        setFullName("");
        setIsActive(true);
        // setIsSuperuser(false);
        setSelectedRoleId("");
        setRoleLockedByGroup(false);
        setLockedAutoGroupName(null);
        setSelectedManualGroupIds([]);
      }
    }
  }, [open, user]);

  const handleRoleChange = (roleId: string) => {
    setSelectedRoleId(roleId);
    setRoleLockedByGroup(false);
    setLockedAutoGroupName(null);
  };

  const handleAutoGroupSelect = (groupId: string) => {
    const group = availableGroups.find((g) => g.id === groupId);
    if (group?.filter_role_id) {
      setSelectedRoleId(group.filter_role_id);
      setRoleLockedByGroup(true);
      setLockedAutoGroupName(group.name);
    }
  };

  const handleManualGroupToggle = (groupId: string) => {
    setSelectedManualGroupIds((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    );
  };

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!user && !username.trim()) errs.username = t("users.validation.usernameRequired");
    if (!email.trim()) errs.email = t("users.validation.emailRequired");
    if (!fullName.trim()) errs.fullName = t("users.validation.fullNameRequired");
    if (!user && !password) errs.password = t("users.validation.passwordRequired");
    if (!selectedRoleId) errs.role = t("users.validation.roleRequired");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    if (user) {
      onEditUser?.(user.id, {
        fullName,
        email,
        isActive,
        roleId: selectedRoleId,
      });
    } else {
      onAddUser({
        username,
        email,
        password,
        fullName,
        roleId: selectedRoleId,
        manualGroupIds: selectedManualGroupIds,
      });
    }
    onClose();
  };

  const manualGroups = availableGroups.filter((g) => g.type === "manual");
  const autoGroups = availableGroups.filter((g) => g.type === "auto");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900 sm:text-xl">
                {user ? t("users.dialog.editTitle") : t("users.dialog.createTitle")}
              </h2>
              {user && (
                <span className="bg-brand-500 rounded-md px-2 py-0.5 text-xs text-white">
                  ID: {user.id}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {user
                ? t("users.dialog.editSubtitle")
                : t("users.dialog.createSubtitle")}
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
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-1">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {t("users.username")} <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setErrors((prev) => ({ ...prev, username: "" }));
                  }}
                  disabled={!!user}
                  className={`h-11 rounded-xl ${errors.username ? "border-red-500" : ""}`}
                />
                {errors.username && (
                  <p className="mt-1 text-xs text-red-500">{errors.username}</p>
                )}
              </div>

              <div className="sm:col-span-1">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {t("users.email")} <span className="text-red-500">*</span>
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrors((prev) => ({ ...prev, email: "" }));
                  }}
                  className={`h-11 rounded-xl ${errors.email ? "border-red-500" : ""}`}
                />
                {errors.email && (
                  <p className="mt-1 text-xs text-red-500">{errors.email}</p>
                )}
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {t("users.fullName")} <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    setErrors((prev) => ({ ...prev, fullName: "" }));
                  }}
                  className={`h-11 rounded-xl ${errors.fullName ? "border-red-500" : ""}`}
                />
                {errors.fullName && (
                  <p className="mt-1 text-xs text-red-500">{errors.fullName}</p>
                )}
              </div>

              {!user && (
                <div className="sm:col-span-1">
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t("users.password")} <span className="text-red-500">*</span>
                  </label>
                  <PasswordInput
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setErrors((prev) => ({ ...prev, password: "" }));
                    }}
                    className={`h-11 w-full rounded-xl ${errors.password ? "border-red-500" : ""}`}
                  />
                  {errors.password && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.password}
                    </p>
                  )}
                </div>
              )}

              {/* Role */}
              <div className="sm:col-span-1">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {t("users.role")} <span className="text-red-500">*</span>
                </label>
                <Select
                  value={selectedRoleId || "__none__"}
                  onValueChange={(v) => {
                    handleRoleChange(v === "__none__" ? "" : v);
                    setErrors((prev) => ({ ...prev, role: "" }));
                  }}
                  disabled={roleLockedByGroup}
                >
                  <SelectTrigger
                    className={`h-11 w-full rounded-xl ${errors.role ? "border-red-500" : ""}`}
                  >
                    <SelectValue placeholder={t("users.dialog.selectRole")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("users.dialog.selectRole")}</SelectItem>
                    {availableRoles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.role && (
                  <p className="mt-1 text-xs text-red-500">{errors.role}</p>
                )}
                {roleLockedByGroup && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                    <Link className="h-3 w-3" />
                    {t("users.dialog.roleLocked")}
                  </p>
                )}
              </div>

              {/* Groups section — only for new users */}
              {isCreating && (
                <>
                  {/* Auto Group */}
                  <div className="sm:col-span-1">
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      {t("users.dialog.autoGroup")}{" "}
                      <span className="text-xs font-normal text-gray-400">
                        ({t("users.dialog.autoGroupByRole")})
                      </span>
                    </label>
                    {selectedRoleId || roleLockedByGroup ? (
                      linkedAutoGroup ? (
                        <div className="border-brand-200 bg-brand-50 flex h-11 items-center gap-2 rounded-xl border px-3">
                          <Link className="text-brand-500 h-4 w-4 flex-shrink-0" />
                          <span className="text-brand-700 truncate text-sm font-medium">
                            {linkedAutoGroup.name}
                          </span>
                          <span className="bg-brand-100 text-brand-600 ml-auto rounded-full px-2 py-0.5 text-xs">
                            Auto
                          </span>
                        </div>
                      ) : (
                        <div className="flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3">
                          <AlertCircle className="h-4 w-4 flex-shrink-0 text-gray-400" />
                          <span className="text-sm text-gray-400">
                            {t("users.dialog.noAutoGroup")}
                          </span>
                        </div>
                      )
                    ) : autoGroups.length > 0 ? (
                      <Select
                        value="__none__"
                        onValueChange={(v) => {
                          if (v !== "__none__") handleAutoGroupSelect(v);
                        }}
                      >
                        <SelectTrigger className="h-11 w-full rounded-xl">
                          <SelectValue placeholder={t("users.dialog.selectAutoGroup")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            {t("users.dialog.selectAutoGroup")}
                          </SelectItem>
                          {autoGroups.map((group) => (
                            <SelectItem key={group.id} value={group.id}>
                              {group.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3">
                        <span className="text-sm text-gray-400">
                          {t("users.dialog.selectRoleFirst")}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Manual Groups */}
                  {manualGroups.length > 0 && (
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">
                        {t("users.dialog.manualGroups")}{" "}
                        <span className="text-xs font-normal text-gray-400">
                          ({t("users.dialog.manualGroupsHint")})
                        </span>
                      </label>
                      <div className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                        {manualGroups.map((group) => {
                          const checked = selectedManualGroupIds.includes(
                            group.id
                          );
                          return (
                            <label
                              key={group.id}
                              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                                checked
                                  ? "border-brand-300 bg-brand-50 text-brand-700"
                                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  handleManualGroupToggle(group.id)
                                }
                                className="sr-only"
                              />
                              {group.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Active status */}
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {t("users.dialog.activeStatus")}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t("users.dialog.activeStatusDesc")}
                    </p>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="peer-checked:bg-brand-500 peer-focus:ring-brand-200 h-6 w-11 rounded-full bg-gray-200 transition peer-focus:ring-4 after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
                  </label>
                </div>
              </div>

              {/* {user && (
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Superuser</p>
                      <p className="text-xs text-gray-500">
                        Full system access, bypasses all permission checks
                      </p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={isSuperuser}
                        onChange={(e) => setIsSuperuser(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="h-6 w-11 rounded-full bg-gray-200 transition peer-checked:bg-amber-500 peer-focus:ring-4 peer-focus:ring-amber-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
                    </label>
                  </div>
                </div>
              )} */}
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
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="bg-brand-500 hover:bg-brand-600 inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-medium text-white transition-colors"
              >
                {user ? t("users.dialog.saveChanges") : t("users.dialog.createUser")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
