import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

export function ErrorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-gray-50">
      <div className="mx-4 flex max-w-md flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100">
          <AlertTriangle className="h-8 w-8 text-yellow-600" />
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-gray-900">
          {t("errors.accessDenied")}
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          {t("errors.accessDeniedMessage")}
        </p>
        <button
          onClick={() => navigate("/")}
          className="bg-brand-500 hover:bg-brand-600 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          {t("errors.goHome")}
        </button>
      </div>
    </div>
  );
}
