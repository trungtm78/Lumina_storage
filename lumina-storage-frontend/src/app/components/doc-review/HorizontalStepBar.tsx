import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

export type ReviewStep = 1 | 2 | 3;

interface HorizontalStepBarProps {
  current: ReviewStep;
  maxReached: ReviewStep;
  onJump: (n: ReviewStep) => void;
}

export function HorizontalStepBar({ current, maxReached, onJump }: HorizontalStepBarProps) {
  const { t } = useTranslation();

  const steps: { n: ReviewStep; label: string }[] = [
    { n: 1, label: t("review.wizard.stepBarFile") },
    { n: 2, label: t("review.wizard.stepBarConfig") },
    { n: 3, label: t("review.wizard.stepBarResult") },
  ];

  return (
    <div className="flex items-center">
      {steps.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        const locked = s.n > maxReached;
        return (
          <div key={s.n} className="flex items-center">
            <button
              disabled={locked}
              onClick={() => !locked && onJump(s.n)}
              className={[
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                active ? "text-brand-600" : done ? "text-foreground hover:bg-muted/60" : "text-muted-foreground",
                locked ? "cursor-not-allowed opacity-40" : "cursor-pointer",
              ].join(" ")}
            >
              <span
                className={[
                  "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0",
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-brand-500 text-white"
                      : "bg-muted text-muted-foreground border border-border",
                ].join(" ")}
              >
                {done ? <Check className="w-3 h-3" /> : s.n}
              </span>
              <span>{s.label}</span>
            </button>
            {i < steps.length - 1 && (
              <div className={`h-px w-8 mx-1 ${done ? "bg-emerald-300" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
