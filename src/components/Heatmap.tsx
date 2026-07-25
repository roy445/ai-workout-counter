"use client";

// GitHub 風格運動足跡熱力圖（近 ~26 週）
type Props = {
  values: Map<string, number>; // date(YYYY-MM-DD) -> 熱量或次數
};

function level(v: number, max: number): number {
  if (v <= 0) return 0;
  const r = v / (max || 1);
  if (r > 0.66) return 4;
  if (r > 0.4) return 3;
  if (r > 0.15) return 2;
  return 1;
}

const COLORS = [
  "rgba(255,255,255,0.06)",
  "rgba(34,211,238,0.28)",
  "rgba(34,211,238,0.5)",
  "rgba(52,211,153,0.7)",
  "rgba(52,211,153,1)",
];

export default function Heatmap({ values }: Props) {
  const weeks = 26;
  const today = new Date();
  // 對齊到本週週日
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const days: { date: string; v: number }[] = [];
  const total = weeks * 7;
  const start = new Date(end);
  start.setDate(start.getDate() - (total - 1));

  let max = 0;
  for (let i = 0; i < total; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const v = values.get(key) ?? 0;
    max = Math.max(max, v);
    days.push({ date: key, v });
  }

  // 依週分欄
  const cols: { date: string; v: number }[][] = [];
  for (let w = 0; w < weeks; w++) {
    cols.push(days.slice(w * 7, w * 7 + 7));
  }

  const monthLabels = ["日", "", "二", "", "四", "", "六"];

  return (
    <div className="overflow-x-auto no-scrollbar">
      <div className="flex gap-[3px]">
        <div className="mr-1 flex flex-col gap-[3px] pt-[2px]">
          {monthLabels.map((m, i) => (
            <div
              key={i}
              className="h-[12px] text-[8px] leading-[12px] text-slate-500"
            >
              {m}
            </div>
          ))}
        </div>
        {cols.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[3px]">
            {col.map((d) => {
              const isFuture = new Date(d.date) > today;
              const lv = level(d.v, max);
              return (
                <div
                  key={d.date}
                  title={`${d.date}：${d.v.toFixed(0)}`}
                  className="h-[12px] w-[12px] rounded-[3px]"
                  style={{
                    background: isFuture ? "transparent" : COLORS[lv],
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[9px] text-slate-500">
        <span>少</span>
        {COLORS.map((c, i) => (
          <span
            key={i}
            className="h-[10px] w-[10px] rounded-[2px]"
            style={{ background: c }}
          />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}
