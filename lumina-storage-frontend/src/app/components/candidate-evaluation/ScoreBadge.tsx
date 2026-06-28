import { useTranslation } from "react-i18next";
import { cn } from "@/app/components/ui/utils";

interface ScoreBadgeProps {
  score: number | null | undefined;
  size?: "sm" | "md";
}

export function ScoreBadge({ score, size = "md" }: ScoreBadgeProps) {
  const hasScore = typeof score === "number" && Number.isFinite(score);
  const color = !hasScore
    ? "bg-gray-100 text-gray-400"
    : score >= 75
      ? "bg-emerald-100 text-emerald-700"
      : score >= 50
        ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md font-bold",
        color,
        size === "sm" ? "px-1.5 py-0.5 text-sm" : "px-2 py-0.5 text-base"
      )}
    >
      {hasScore ? Math.round(score) : "—"}
    </span>
  );
}

interface RecommendationBadgeProps {
  recommendation: string;
}

export function RecommendationBadge({
  recommendation,
}: RecommendationBadgeProps) {
  const { t } = useTranslation();
  const recConfig: Record<string, { label: string; className: string }> = {
    strong_fit: {
      label: t("candidateEvaluation.recommendation.strongFit"),
      className: "bg-emerald-100 text-emerald-700",
    },
    good_fit: {
      label: t("candidateEvaluation.recommendation.goodFit"),
      className: "bg-blue-100 text-blue-700",
    },
    moderate_fit: {
      label: t("candidateEvaluation.recommendation.moderateFit"),
      className: "bg-amber-100 text-amber-700",
    },
    weak_fit: {
      label: t("candidateEvaluation.recommendation.weakFit"),
      className: "bg-red-100 text-red-700",
    },
    not_recommended: {
      label: t("candidateEvaluation.recommendation.notRecommended"),
      className: "bg-gray-100 text-gray-600",
    },
  };
  const cfg = recConfig[recommendation] ?? {
    label: recommendation,
    className: "bg-gray-100 text-gray-600",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-sm font-semibold",
        cfg.className
      )}
    >
      {cfg.label}
    </span>
  );
}
