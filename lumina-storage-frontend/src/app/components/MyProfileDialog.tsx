import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Input } from "@/app/components/ui/input";
import { useAuthStore } from "@/app/stores/authStore";
import { usersApi } from "@/app/api/endpoints/users";
import { toast } from "sonner";

interface MyProfileDialogProps {
  open: boolean;
  onClose: () => void;
}

export function MyProfileDialog({ open, onClose }: MyProfileDialogProps) {
  const { t } = useTranslation();
  const profile = useAuthStore((s) => s.profile);
  const fetchProfile = useAuthStore((s) => s.fetchProfile);

  const [editing, setEditing] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [fullName, setFullName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (open) {
      setEditing(false);
      setChangingPwd(false);
      setFullName(profile?.full_name ?? "");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }, [open, profile]);

  const mutation = useMutation({
    mutationFn: (name: string) =>
      usersApi.update(profile!.id, { full_name: name }),
    onSuccess: async () => {
      await fetchProfile();
      setEditing(false);
      toast.success(t("profile.profileSaved"));
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || t("profile.profileSaveFailed");
      toast.error(msg);
    },
  });

  const pwdMutation = useMutation({
    mutationFn: () =>
      usersApi.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    onSuccess: () => {
      setChangingPwd(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success(t("profile.passwordChanged"));
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || t("profile.passwordChangeFailed");
      toast.error(msg);
    },
  });

  if (!open || !profile) return null;

  const initial =
    profile.full_name?.[0]?.toUpperCase() ??
    profile.username?.[0]?.toUpperCase() ??
    "?";

  const role = profile.role?.name ?? "Member";

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    mutation.mutate(fullName.trim());
  };

  const handlePasswordSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      toast.error(t("profile.currentPasswordRequired"));
      return;
    }
    if (newPassword.length < 6) {
      toast.error(t("profile.passwordMinLength"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("profile.passwordMismatch"));
      return;
    }
    pwdMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{t("profile.title")}</h2>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Avatar */}
          <div className="mb-6 flex justify-center">
            <div className="bg-brand-500 flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white shadow">
              {initial}
            </div>
          </div>

          {/* Info */}
          <div className="space-y-4">
            {changingPwd ? (
              <form onSubmit={handlePasswordSave} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t("profile.currentPassword")}
                  </label>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="h-11 rounded-xl"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t("profile.newPassword")}
                  </label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-11 rounded-xl"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t("profile.confirmNewPassword")}
                  </label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-11 rounded-xl"
                    required
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setChangingPwd(false)}
                    className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={pwdMutation.isPending}
                    className="bg-brand-500 hover:bg-brand-600 flex-1 rounded-xl py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
                  >
                    {pwdMutation.isPending ? t("common.saving") : t("profile.changePassword")}
                  </button>
                </div>
              </form>
            ) : editing ? (
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t("profile.fullName")}
                  </label>
                  <Input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="h-11 rounded-xl"
                    required
                    autoFocus
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={mutation.isPending}
                    className="bg-brand-500 hover:bg-brand-600 flex-1 rounded-xl py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
                  >
                    {mutation.isPending ? t("common.saving") : t("common.save")}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <div>
                    <p className="text-xs text-gray-500">{t("profile.fullName")}</p>
                    <p className="text-sm font-medium text-gray-900">
                      {profile.full_name || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{t("profile.username")}</p>
                    <p className="text-sm font-medium text-gray-900">
                      @{profile.username}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{t("profile.email")}</p>
                    <p className="text-sm font-medium text-gray-900">
                      {profile.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-xs text-gray-500">{t("profile.status")}</p>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          profile.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {profile.is_active ? t("users.active") : t("users.inactive")}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">{t("profile.role")}</p>
                      <span className="bg-brand-100 text-brand-700 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium">
                        {role}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(true)}
                    className="border-brand-200 text-brand-600 hover:bg-brand-50 flex-1 rounded-xl border py-2.5 text-sm font-medium transition-colors"
                  >
                    {t("profile.editProfile")}
                  </button>
                  <button
                    onClick={() => setChangingPwd(true)}
                    className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    {t("profile.changePassword")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
