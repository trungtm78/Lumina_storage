import { Check } from "lucide-react";
import { cn } from "@/app/components/ui/utils";

interface StepLabelProps {
  step: number;
  label: string;
  done: boolean;
  active: boolean;
}

export function StepLabel({ step, label, done, active }: StepLabelProps) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <div
        className={cn(
          "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-all",
          done
            ? "bg-brand-500 text-white"
            : active
              ? "bg-brand-100 text-brand-600 border-brand-300 border"
              : "bg-muted text-muted-foreground"
        )}
      >
        {done ? <Check className="h-3 w-3" /> : step}
      </div>
      <span
        className={cn(
          "text-xs font-semibold tracking-wide uppercase",
          active
            ? "text-foreground"
            : done
              ? "text-muted-foreground"
              : "text-muted-foreground/60"
        )}
      >
        {label}
      </span>
    </div>
  );
}
