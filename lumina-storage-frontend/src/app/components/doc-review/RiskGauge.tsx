import { getRiskStyle } from "@/app/utils/doc-review/risk";

interface RiskGaugeProps {
  score: number;
  size?: number;
}

export function RiskGauge({ score, size = 100 }: RiskGaugeProps) {
  const { ring, text, label } = getRiskStyle(score);
  const radius = size * 0.36;
  const circ = 2 * Math.PI * radius;
  const dashOffset = circ * (1 - score / 100);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-muted/30"
          strokeWidth="8"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={ring}
          strokeWidth="8"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: "50% 50%",
            transition: "stroke-dashoffset 0.6s ease",
          }}
        />
        <text
          x={size / 2}
          y={size / 2 - 3}
          textAnchor="middle"
          className="fill-foreground"
          fontSize={size * 0.18}
          fontWeight="bold"
        >
          {score}
        </text>
        <text
          x={size / 2}
          y={size / 2 + 12}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={size * 0.09}
        >
          / 100
        </text>
      </svg>
      <span className={`text-xs font-semibold ${text}`}>{label}</span>
    </div>
  );
}
