import { useState } from "react";
import { Lock } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { PasswordInput } from "@/app/components/password-input";
import { usersApi } from "@/app/api/endpoints/users";
import { useAuthStore } from "@/app/stores/authStore";
import { useAppTitle, useBranding } from "@/app/contexts/BrandingContext";

const MIN_PASSWORD_LENGTH = 8;

function isStrongPassword(value: string) {
  return (
    value.length >= MIN_PASSWORD_LENGTH &&
    /[A-Za-z]/.test(value) &&
    /\d/.test(value)
  );
}

export function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);
  const setMustChangePassword = useAuthStore((s) => s.setMustChangePassword);
  const { settings } = useBranding();
  const appTitle = useAppTitle();
  const logoSrc = settings?.logo_url || "/lumina-logo.png";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      usersApi.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    onSuccess: () => {
      setMustChangePassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success(t("auth.passwordUpdated"));
      navigate("/", { replace: true });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || t("auth.changePasswordFailed");
      toast.error(msg);
    },
  });

  if (!mustChangePassword) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentPassword) {
      toast.error(t("auth.enterCurrentPassword"));
      return;
    }
    if (!isStrongPassword(newPassword)) {
      toast.error(t("auth.passwordStrengthHint"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("auth.passwordMismatch"));
      return;
    }

    mutation.mutate();
  };

  return (
    <div className="from-brand-50 flex min-h-screen items-center justify-center bg-gradient-to-br via-white to-pink-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden">
            <img
              src={logoSrc}
              alt={appTitle}
              className="h-16 w-16 object-contain"
            />
          </div>
          <h1 className="text-brand-400 mb-2 text-2xl font-semibold">
            {t("auth.changePassword")}
          </h1>
          <p className="text-sm text-gray-500">
            {t("auth.changePasswordSubtitle")}
          </p>
        </div>

        <div className="mb-6 rounded-2xl bg-white p-8 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("auth.currentPassword")}
              </label>
              <div className="relative">
                <Lock className="absolute top-1/2 left-3 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <PasswordInput
                  name="current_password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={t("auth.enterCurrentPasswordPlaceholder")}
                  className="focus:ring-brand-400 w-full rounded-lg border border-gray-200 bg-gray-50 py-3 pl-11 transition-all focus:border-transparent focus:ring-2 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("auth.newPassword")}
              </label>
              <div className="relative">
                <Lock className="absolute top-1/2 left-3 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <PasswordInput
                  name="new_password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("auth.newPasswordPlaceholder")}
                  className="focus:ring-brand-400 w-full rounded-lg border border-gray-200 bg-gray-50 py-3 pl-11 transition-all focus:border-transparent focus:ring-2 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("auth.confirmPassword")}
              </label>
              <div className="relative">
                <Lock className="absolute top-1/2 left-3 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <PasswordInput
                  name="confirm_password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t("auth.confirmPasswordPlaceholder")}
                  className="focus:ring-brand-400 w-full rounded-lg border border-gray-200 bg-gray-50 py-3 pl-11 transition-all focus:border-transparent focus:ring-2 focus:outline-none"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={mutation.isPending}
              className="from-brand-400 hover:from-brand-500 w-full rounded-lg bg-gradient-to-r to-pink-400 py-3 font-medium text-white shadow-lg transition-all hover:to-pink-500 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? t("auth.updating") : t("auth.updatePassword")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
