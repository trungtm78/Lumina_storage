import { useTranslation } from "react-i18next";
import { ClipboardList, Table2 } from "lucide-react";
import { cn } from "@/app/components/ui/utils";

interface HomeScreenProps {
  onSelect: (mode: "evaluation" | "master-list") => void;
}

interface ModeCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

function ModeCard({ icon, title, description, onClick }: ModeCardProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-4 rounded-xl border border-gray-200 bg-white p-6 text-left",
        "hover:border-brand-300 transition-all hover:shadow-md",
        "focus:ring-brand-500 focus:ring-2 focus:ring-offset-2 focus:outline-none"
      )}
    >
      <div className="bg-brand-50 text-brand-600 flex h-12 w-12 items-center justify-center rounded-lg">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>
      <span className="text-brand-600 mt-auto text-sm font-medium">
        {t("candidateEvaluation.home.start")}
      </span>
    </button>
  );
}

export function HomeScreen({ onSelect }: HomeScreenProps) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          {t("candidateEvaluation.home.title")}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {t("candidateEvaluation.home.subtitle")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ModeCard
          icon={<ClipboardList className="h-6 w-6" />}
          title={t("candidateEvaluation.home.evaluationTitle")}
          description={t("candidateEvaluation.home.evaluationDesc")}
          onClick={() => onSelect("evaluation")}
        />
        <ModeCard
          icon={<Table2 className="h-6 w-6" />}
          title={t("candidateEvaluation.home.masterListTitle")}
          description={t("candidateEvaluation.home.masterListDesc")}
          onClick={() => onSelect("master-list")}
        />
      </div>
    </div>
  );
}
