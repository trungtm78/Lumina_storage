import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { cn } from "@/app/components/ui/utils";
import { useLanguage, type SupportedLocale } from "@/app/hooks/useLanguage";

interface LanguageSelectorProps {
  className?: string;
}

export function LanguageSelector({ className }: LanguageSelectorProps) {
  const { t } = useTranslation();
  const { currentLocale, changeLocale, changing, languages } = useLanguage();
  const currentLanguage =
    languages.find((lang) => lang.code === currentLocale) ?? languages[0];

  const handleLanguageChange = (value: string) => {
    void changeLocale(value as SupportedLocale);
  };

  return (
    <Select
      value={currentLocale}
      onValueChange={handleLanguageChange}
      disabled={changing}
    >
      <SelectTrigger
        className={cn(
          "h-8 rounded-lg border border-brand-500/30 bg-brand-500/10 px-2 pr-2.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-brand-500/15",
          className
        )}
        aria-label={t("header.language")}
      >
        <SelectValue>
          <div className="flex items-center gap-1.5">
            <Languages className="h-4 w-4 text-brand-500" />
            <span className="text-[11px] font-semibold uppercase text-gray-900">
              {currentLanguage.code.toUpperCase()}
            </span>
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="w-48 border-brand-500/20 p-1">
        {languages.map((lang) => (
          <SelectItem key={lang.code} value={lang.code} className="rounded-md px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="bg-brand-500/10 text-brand-600 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
                {lang.code.toUpperCase()}
              </span>
              <span className="text-sm font-medium">{lang.label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
