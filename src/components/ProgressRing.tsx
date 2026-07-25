"use client";

type Props = {
  size?: number;
  stroke?: number;
  progress: number; // 0~1 外環（本次動作進度）
  fraction?: number; // 0~1 內環（目標達成度）
  children?: React.ReactNode;
  color?: string;
  trackColor?: string;
};

// 雙層圓形進度環：外環顯示本次動作幅度，內環顯示目標達成度
export default function ProgressRing({
  size = 220,
  stroke = 12,
  progress,
  fraction,
  children,
  color = "#22d3ee",
  trackColor = "rgba(255,255,255,0.08)",
}: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));

  const innerR = fraction != null ? r - stroke - 4 : r;
  const innerC = 2 * Math.PI * innerR;
  const f = Math.max(0, Math.min(1, fraction ?? 0));

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          style={{
            transition: "stroke-dashoffset 0.12s linear",
            filter: `drop-shadow(0 0 6px ${color}66)`,
          }}
        />
        {fraction != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={innerR}
            fill="none"
            stroke="#34d399"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={innerC}
            strokeDashoffset={innerC * (1 - f)}
            style={{ transition: "stroke-dashoffset 0.3s ease" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}
