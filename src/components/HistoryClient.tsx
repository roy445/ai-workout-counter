"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EXERCISES, EXERCISE_LIST, type ExerciseKey } from "@/lib/exercises";
import { computeAchievements } from "@/lib/achievements";
import Heatmap from "@/components/Heatmap";
import ProgressRing from "@/components/ProgressRing";
import ThemeToggle from "@/components/ThemeToggle";

type Session = {
  id: number;
  exercise: string;
  reps: number;
  durationSeconds: number;
  calories: number;
  workoutDate: string;
  createdAt: string;
};

function exName(key: string) {
  const def = EXERCISES[key as ExerciseKey];
  return def ? `${def.emoji} ${def.name}` : key;
}

function mmss(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}分${sec}秒` : `${sec}秒`;
}

export default function HistoryClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/sessions");
      const data = await resp.json();
      if (data.ok) setSessions(data.sessions);
      else setError(data.error || "讀取失敗");
    } catch {
      setError("讀取失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (id: number) => {
    if (!confirm("確定刪除這筆紀錄？")) return;
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    setSessions((s) => s.filter((x) => x.id !== id));
  };

  const today = new Date().toISOString().slice(0, 10);

  const byDate = useMemo(() => {
    const map = new Map<
      string,
      {
        date: string;
        reps: number;
        seconds: number;
        calories: number;
        count: number;
      }
    >();
    for (const s of sessions) {
      const cur =
        map.get(s.workoutDate) ?? {
          date: s.workoutDate,
          reps: 0,
          seconds: 0,
          calories: 0,
          count: 0,
        };
      cur.reps += s.reps;
      cur.seconds += s.durationSeconds;
      cur.calories += s.calories;
      cur.count += 1;
      map.set(s.workoutDate, cur);
    }
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [sessions]);

  const todayStat = byDate.find((d) => d.date === today);

  // 連續運動天數 streak
  const streak = useMemo(() => {
    const set = new Set(byDate.map((d) => d.date));
    let count = 0;
    const cur = new Date();
    // 若今天沒運動，從昨天開始算仍算連續
    if (!set.has(today)) cur.setDate(cur.getDate() - 1);
    for (;;) {
      const key = cur.toISOString().slice(0, 10);
      if (set.has(key)) {
        count++;
        cur.setDate(cur.getDate() - 1);
      } else break;
    }
    return count;
  }, [byDate, today]);

  // 近 14 天趨勢
  const trend = useMemo(() => {
    const days: { date: string; calories: number; reps: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const found = byDate.find((x) => x.date === key);
      days.push({
        date: key,
        calories: found ? found.calories : 0,
        reps: found ? found.reps : 0,
      });
    }
    return days;
  }, [byDate]);

  const totals = useMemo(() => {
    return sessions.reduce(
      (acc, s) => {
        acc.reps += s.reps;
        acc.seconds += s.durationSeconds;
        acc.calories += s.calories;
        return acc;
      },
      { reps: 0, seconds: 0, calories: 0 },
    );
  }, [sessions]);

  // 各運動彙整 + 個人紀錄(單次最佳)
  const perExercise = useMemo(() => {
    const map = new Map<
      string,
      { key: string; reps: number; seconds: number; best: number; sessions: number }
    >();
    for (const s of sessions) {
      const cur =
        map.get(s.exercise) ?? {
          key: s.exercise,
          reps: 0,
          seconds: 0,
          best: 0,
          sessions: 0,
        };
      cur.reps += s.reps;
      cur.seconds += s.durationSeconds;
      cur.sessions += 1;
      const def = EXERCISES[s.exercise as ExerciseKey];
      const metric = def?.timeBased ? s.durationSeconds : s.reps;
      cur.best = Math.max(cur.best, metric);
      map.set(s.exercise, cur);
    }
    return EXERCISE_LIST.map((ex) => map.get(ex.key)).filter(
      (v): v is NonNullable<typeof v> => !!v && (v.reps > 0 || v.seconds > 0),
    );
  }, [sessions]);

  // 熱力圖資料（依日期的熱量）
  const heatValues = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of byDate) m.set(d.date, d.calories);
    return m;
  }, [byDate]);

  // 本週目標（每週運動天數，預設 5 天，可調整並記住）
  const [weeklyGoal, setWeeklyGoal] = useState(5);
  useEffect(() => {
    const g = Number(localStorage.getItem("workout_weekly_goal"));
    if (g > 0) setWeeklyGoal(g);
  }, []);
  useEffect(() => {
    localStorage.setItem("workout_weekly_goal", String(weeklyGoal));
  }, [weeklyGoal]);

  const weekProgress = useMemo(() => {
    const now = new Date();
    const day = now.getDay(); // 0=日
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const set = new Set(byDate.map((d) => d.date));
    let done = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      if (set.has(d.toISOString().slice(0, 10))) done++;
    }
    return { done, goal: weeklyGoal };
  }, [byDate, weeklyGoal]);

  // 成就
  const achievements = useMemo(() => {
    const distinct = new Set(sessions.map((s) => s.exercise)).size;
    return computeAchievements({
      totalReps: totals.reps,
      totalCalories: totals.calories,
      totalSeconds: totals.seconds,
      streak,
      workoutDays: byDate.length,
      distinctExercises: distinct,
      sessions: sessions.length,
    });
  }, [sessions, totals, streak, byDate.length]);

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  // 匯出 CSV
  const exportCsv = () => {
    const header = "日期,時間,運動,次數,時長(秒),熱量(kcal)\n";
    const rows = sessions
      .map((s) => {
        const dt = new Date(s.createdAt).toLocaleString("zh-TW");
        const name = EXERCISES[s.exercise as ExerciseKey]?.name ?? s.exercise;
        return `${s.workoutDate},${dt},${name},${s.reps},${s.durationSeconds},${s.calories.toFixed(1)}`;
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `運動紀錄_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
            📊 訓練數據
          </h1>
          <p className="text-xs text-slate-400">個人運動趨勢與紀錄總覽</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            className="rounded-xl glass px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
            title="匯出所有紀錄為 CSV"
          >
            📤 匯出
          </button>
          <ThemeToggle />
          <Link
            href="/"
            className="rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-5 py-2 text-sm font-bold text-slate-900 transition hover:scale-105"
          >
            ← 開始訓練
          </Link>
        </div>
      </header>

      {loading ? (
        <p className="py-20 text-center text-slate-500">載入中…</p>
      ) : error ? (
        <p className="py-20 text-center text-red-400">{error}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {/* 頂部指標 */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <BigStat
              label="🔥 連續天數"
              value={String(streak)}
              unit="天"
              accent="text-orange-400"
            />
            <BigStat
              label="今日次數"
              value={todayStat ? String(todayStat.reps) : "0"}
              accent="text-cyan-400"
            />
            <BigStat
              label="今日熱量"
              value={todayStat ? todayStat.calories.toFixed(0) : "0"}
              unit="kcal"
              accent="text-emerald-400"
            />
            <BigStat
              label="累計熱量"
              value={totals.calories.toFixed(0)}
              unit="kcal"
              accent="text-violet-400"
            />
          </section>

          {/* 本週目標 + 運動足跡 */}
          <section className="grid gap-4 lg:grid-cols-[auto_1fr]">
            <div className="glass flex flex-col items-center rounded-3xl p-5">
              <h2 className="mb-3 text-sm font-semibold text-white">本週目標</h2>
              <ProgressRing
                size={150}
                stroke={12}
                progress={Math.min(1, weekProgress.done / weekProgress.goal)}
                color="#34d399"
              >
                <div className="text-3xl font-black tabular text-white">
                  {weekProgress.done}
                  <span className="text-lg text-slate-400">
                    /{weekProgress.goal}
                  </span>
                </div>
                <div className="text-[10px] uppercase tracking-widest text-emerald-300">
                  天
                </div>
              </ProgressRing>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                <span>每週目標</span>
                <button
                  onClick={() => setWeeklyGoal((g) => Math.max(1, g - 1))}
                  className="h-6 w-6 rounded-lg bg-white/10 text-white"
                >
                  −
                </button>
                <span className="tabular font-bold text-white">{weeklyGoal}</span>
                <button
                  onClick={() => setWeeklyGoal((g) => Math.min(7, g + 1))}
                  className="h-6 w-6 rounded-lg bg-white/10 text-white"
                >
                  +
                </button>
              </div>
            </div>
            <div className="glass rounded-3xl p-5">
              <h2 className="mb-4 text-base font-semibold text-white">
                運動足跡（近半年）
              </h2>
              <Heatmap values={heatValues} />
            </div>
          </section>

          {/* 成就徽章 */}
          <section className="glass rounded-3xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">成就徽章</h2>
              <span className="text-xs text-slate-400">
                已解鎖 {unlockedCount} / {achievements.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {achievements.map((a) => (
                <div
                  key={a.id}
                  className={`rounded-2xl p-3 text-center transition ${
                    a.unlocked
                      ? "bg-gradient-to-br from-amber-400/20 to-amber-500/5 ring-1 ring-amber-400/40"
                      : "bg-black/30 opacity-70"
                  }`}
                >
                  <div
                    className={`text-3xl ${a.unlocked ? "" : "grayscale"}`}
                    style={{ filter: a.unlocked ? "none" : "grayscale(1)" }}
                  >
                    {a.emoji}
                  </div>
                  <div className="mt-1 text-sm font-bold text-white">
                    {a.name}
                  </div>
                  <div className="text-[10px] text-slate-400">{a.desc}</div>
                  {!a.unlocked && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-amber-400"
                        style={{ width: `${Math.round(a.progress * 100)}%` }}
                      />
                    </div>
                  )}
                  {a.unlocked && (
                    <div className="mt-1 text-[10px] font-semibold text-amber-400">
                      ✓ 已達成
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 趨勢圖 */}
          <section className="glass rounded-3xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">
                近 14 天熱量趨勢
              </h2>
              <span className="text-xs text-slate-400">
                累計 {totals.reps} 次 · {mmss(totals.seconds)}
              </span>
            </div>
            <TrendChart data={trend} />
          </section>

          {/* 各運動統計 + PR */}
          <section className="glass rounded-3xl p-5">
            <h2 className="mb-4 text-base font-semibold text-white">
              各項目統計與個人紀錄
            </h2>
            {perExercise.length === 0 ? (
              <p className="text-sm text-slate-500">還沒有紀錄，快去訓練吧！</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {perExercise.map((e) => {
                  const def = EXERCISES[e.key as ExerciseKey];
                  return (
                    <div
                      key={e.key}
                      className="flex items-center justify-between rounded-2xl bg-black/30 px-4 py-3"
                    >
                      <div>
                        <div className="font-semibold text-white">
                          {exName(e.key)}
                        </div>
                        <div className="text-xs text-slate-400">
                          {e.sessions} 次訓練 ·{" "}
                          {def?.timeBased
                            ? mmss(e.seconds)
                            : `${e.reps} 次`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-widest text-amber-400">
                          PR 最佳
                        </div>
                        <div className="text-lg font-bold tabular text-white">
                          {def?.timeBased ? mmss(e.best) : `${e.best} 次`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 每日彙整 */}
          <section className="glass rounded-3xl p-5">
            <h2 className="mb-4 text-base font-semibold text-white">每日彙整</h2>
            {byDate.length === 0 ? (
              <p className="text-sm text-slate-500">尚無紀錄。</p>
            ) : (
              <div className="space-y-2">
                {byDate.map((d) => (
                  <div
                    key={d.date}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-black/30 px-4 py-3"
                  >
                    <span className="font-semibold text-white">
                      {d.date === today && (
                        <span className="mr-2 rounded-full bg-cyan-500 px-2 py-0.5 text-xs text-slate-900">
                          今天
                        </span>
                      )}
                      {d.date}
                    </span>
                    <span className="text-xs text-slate-400">
                      {d.count} 組 · {d.reps} 次 · {mmss(d.seconds)} ·{" "}
                      {d.calories.toFixed(0)} kcal
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 詳細紀錄 */}
          <section className="glass rounded-3xl p-5">
            <h2 className="mb-4 text-base font-semibold text-white">詳細紀錄</h2>
            {sessions.length === 0 ? (
              <p className="text-sm text-slate-500">尚無紀錄。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-xs text-slate-500">
                      <th className="py-2 pr-3">時間</th>
                      <th className="py-2 pr-3">運動</th>
                      <th className="py-2 pr-3">次數</th>
                      <th className="py-2 pr-3">時長</th>
                      <th className="py-2 pr-3">熱量</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr
                        key={s.id}
                        className="border-b border-white/5 text-slate-200 last:border-0"
                      >
                        <td className="py-2 pr-3 text-slate-400">
                          {new Date(s.createdAt).toLocaleString("zh-TW", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-2 pr-3">{exName(s.exercise)}</td>
                        <td className="py-2 pr-3 tabular">{s.reps}</td>
                        <td className="py-2 pr-3">{mmss(s.durationSeconds)}</td>
                        <td className="py-2 pr-3 tabular">
                          {s.calories.toFixed(1)}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => remove(s.id)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            刪除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function BigStat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent: string;
}) {
  return (
    <div className="glass rounded-2xl p-4 text-center">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular ${accent}`}>{value}</div>
      {unit && <div className="text-[10px] text-slate-500">{unit}</div>}
    </div>
  );
}

function TrendChart({
  data,
}: {
  data: { date: string; calories: number; reps: number }[];
}) {
  const max = Math.max(1, ...data.map((d) => d.calories));
  return (
    <div className="flex h-44 items-end gap-1.5">
      {data.map((d) => {
        const h = (d.calories / max) * 100;
        const day = d.date.slice(8);
        return (
          <div
            key={d.date}
            className="group flex flex-1 flex-col items-center justify-end gap-1"
          >
            <div
              className="mx-auto w-full max-w-[24px] rounded-t bg-gradient-to-t from-cyan-500/60 to-emerald-400 transition-all group-hover:from-cyan-400"
              style={{ height: `${Math.max(3, h * 1.4)}px` }}
              title={`${d.date}：${d.calories.toFixed(0)} kcal / ${d.reps} 次`}
            />
            <span className="text-[9px] text-slate-500">{day}</span>
          </div>
        );
      })}
    </div>
  );
}
