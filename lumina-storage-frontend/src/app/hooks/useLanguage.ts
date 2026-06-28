import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { usersApi } from "@/app/api/endpoints/users";
import { useAuthStore } from "@/app/stores/authStore";

export type SupportedLocale = "vi" | "en";

export const SUPPORTED_LANGUAGES: {
  code: SupportedLocale;
  label: string;
  flag: string;
}[] = [
  { code: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
  { code: "en", label: "English", flag: "🇺🇸" },
];

export function useLanguage() {
  const { i18n } = useTranslation();
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const [changing, setChanging] = useState(false);

  const currentLocale = (i18n.language as SupportedLocale) ?? "vi";

  const changeLocale = useCallback(
    async (locale: SupportedLocale) => {
      if (locale === currentLocale || changing) return;
      setChanging(true);
      try {
        if (profile) {
          await usersApi.updatePreferences({ locale });
          setProfile({ ...profile, locale });
        }
        localStorage.setItem("lumina_locale", locale);
        await i18n.changeLanguage(locale);
      } catch {
        toast.error(i18n.t("errors.unknownError"));
      } finally {
        setChanging(false);
      }
    },
    [currentLocale, changing, profile, i18n, setProfile]
  );

  return {
    currentLocale,
    changeLocale,
    changing,
    languages: SUPPORTED_LANGUAGES,
  };
}
