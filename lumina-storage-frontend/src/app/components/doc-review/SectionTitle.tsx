import type { ComponentType } from "react";
import { cn } from "@/app/components/ui/utils";

interface SectionTitleProps {
  title: string;
  count?: number;
  icon?: ComponentType<{ className?: string }>;
  color?: string;
}

export function SectionTitle({
  title,
  count,
  icon: Icon,
  color,
}: SectionTitleProps) {
  return (
    <div className="flex items-center gap-2">
      {Icon && (
        <Icon className={cn("h-3.5 w-3.5", color ?? "text-muted-foreground")} />
      )}
      <span className="text-foreground text-[10px] font-semibold tracking-wider uppercase">
        {title}
      </span>
      {typeof count === "number" && (
        <span className="text-muted-foreground text-[10px]">({count})</span>
      )}
    </div>
  );
}
