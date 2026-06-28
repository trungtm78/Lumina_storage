import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { authApi } from "@/app/api/endpoints/auth";
import { usersApi } from "@/app/api/endpoints/users";
import { useAuthStore, getStorageAuthMode } from "@/app/stores/authStore";
import type { LoginRequest } from "@/app/types/api";

export function useLogin() {
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const setToken = useAuthStore((s) => s.setToken);
  const setMustChangePassword = useAuthStore((s) => s.setMustChangePassword);
  const fetchProfile = useAuthStore((s) => s.fetchProfile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setAuthMode = useAuthStore((s) => s.setAuthMode);
  const resolveLocale = (locale: string) => (locale === "en" ? "en" : "vi");

  return useMutation({
    mutationFn: (data: LoginRequest) => authApi.login(data),
    onSuccess: async (response) => {
      queryClient.clear();
      setAuthMode("local");
      setToken(response.access_token);
      setMustChangePassword(Boolean(response.must_change_password));
      const profile = await fetchProfile();
      const resolvedLocale = resolveLocale(i18n.language);

      if (profile && profile.locale !== resolvedLocale) {
        try {
          await usersApi.updatePreferences({ locale: resolvedLocale });
          setProfile({ ...profile, locale: resolvedLocale });
        } catch {
          toast.error(i18n.t("errors.unknownError"));
        }
      }
    },
  });
}

export function useCurrentUser() {
  const accessToken = useAuthStore((s) => s.accessToken);

  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => authApi.me(),
    enabled: !!accessToken,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const logout = useAuthStore((s) => s.logout);

  return useMutation({
    mutationFn: () => {
      // Microsoft sessions are Azure-managed — no server-side session to revoke
      if (getStorageAuthMode() === "microsoft_msal") return Promise.resolve();
      return authApi.logout();
    },
    onSettled: async () => {
      const redirected = await logout(); // Microsoft/SSO: redirect; local: returns false
      queryClient.clear();

      if (!redirected) {
        window.location.href = "/login";
      }
    },
  });
}
