export type RiskLevel = "safe" | "low" | "medium" | "high" | "very_high";

export interface RiskStyle {
  level: RiskLevel;
  label: string;
  ring: string;
  text: string;
  badge: string;
}

export function getRiskStyle(score: number): RiskStyle {
  if (score <= 20) {
    return {
      level: "safe",
      label: "Safe",
      ring: "stroke-emerald-500",
      text: "text-emerald-600",
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }
  if (score <= 40) {
    return {
      level: "low",
      label: "Low Risk",
      ring: "stroke-sky-500",
      text: "text-sky-600",
      badge: "bg-sky-50 text-sky-700 border-sky-200",
    };
  }
  if (score <= 60) {
    return {
      level: "medium",
      label: "Medium Risk",
      ring: "stroke-amber-500",
      text: "text-amber-600",
      badge: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }
  if (score <= 80) {
    return {
      level: "high",
      label: "High Risk",
      ring: "stroke-orange-500",
      text: "text-orange-600",
      badge: "bg-orange-50 text-orange-700 border-orange-200",
    };
  }
  return {
    level: "very_high",
    label: "Very High Risk",
    ring: "stroke-red-500",
    text: "text-red-600",
    badge: "bg-red-50 text-red-700 border-red-200",
  };
}
