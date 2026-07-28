"use client";

import { useEffect, useState } from "react";
import { EXERCISES } from "@/lib/exercise-detector";

interface ExerciseRecord { id: number; exerciseType: string; reps: number; duration: number; avgQuality: number; }
interface Session { id: number; startedAt: string; totalDuration: number; totalReps: number; avgQuality: number; exercises: ExerciseRecord[]; }
interface DailyStat { id: number; dateStr: string; totalReps: number; totalDuration: number; exerciseTypes: string; streakDays: number; }
interface LBEntry { rank: number; displayName: string; totalReps: number; totalDuration: number; totalSessions: number; avgQuality: number; bestStreak: number; }

function fmt(s: number) { return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`; }
function fmtDate(d: string) { return new Date(d).toLocaleDateString("zh-TW", { month: "short", day: "numeric", weekday: "short" }); }
function exInfo(t: string) { return EXERCISES.find((e) => e.id === t) || { icon: "💪", nameZh: t, name: t }; }

export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [daily, setDaily] = useState<DailyStat[]>([]);
  const [lb, setLb] = useState<LBEntry[]>([]);
  const [tab, setTab] = useState<"history" | "stats" | "leaderboard" | "achievements">("history");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [wr, lr] = await Promise.all([fetch("/api/workouts"), fetch("/api/leaderboard")]);
        const wd = await wr.json(); const ld = await lr.json();
        setSessions(wd.sessions || []); setDaily(wd.dailyStats || []); setLb(ld.leaderboard || []);
      } catch { /* skip */ } finally { setLoading(false); }
    })();
  }, []);

  const totR = sessions.reduce((s, x) => s + (x.totalReps || 0), 0);
  const totD = sessions.reduce((s, x) => s + (x.totalDuration || 0), 0);
  const streak = daily.length > 0 ? daily[0].streakDays || 0 : 0;

  const achs = [
    { id: "f", title: "🎯 首次運動", desc: "完成第一次訓練", ok: sessions.length >= 1 },
    { id: "10", title: "💪 入門者", desc: "累計 10 次", ok: totR >= 10 },
    { id: "50", title: "🏋️ 運動達人", desc: "累計 50 次", ok: totR >= 50 },
    { id: "100", title: "🔥 健身狂人", desc: "累計 100 次", ok: totR >= 100 },
    { id: "500", title: "🏆 鋼鐵意志", desc: "累計 500 次", ok: totR >= 500 },
    { id: "s3", title: "📅 連續三天", desc: "連續運動 3 天", ok: streak >= 3 },
    { id: "s7", title: "⭐ 一週不斷", desc: "連續運動 7 天", ok: streak >= 7 },
    { id: "ss", title: "🎪 訓練常客", desc: "完成 5 次訓練", ok: sessions.length >= 5 },
    { id: "tm", title: "⏱️ 半小時戰士", desc: "累計 30 分鐘", ok: totD >= 1800 },
  ];

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
      <header className="bg-black/40 backdrop-blur-md border-b border-white/10 px-3 sm:px-4 py-2 sm:py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 hover:opacity-80 transition">
            <span className="text-xl sm:text-2xl">🏋️‍♂️</span>
            <span className="text-sm sm:text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">AI 運動教練</span>
          </a>
          <a href="/workout" className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 font-medium text-xs sm:text-sm">🎯 開始運動</a>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-3 sm:p-4">
        {/* Stats overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4 sm:mb-6">
          {[
            { v: totR, c: "text-cyan-400", l: "總次數" },
            { v: fmt(totD), c: "text-purple-400", l: "總時間" },
            { v: sessions.length, c: "text-green-400", l: "訓練次數" },
            { v: `🔥 ${streak}`, c: "text-orange-400", l: "連續天數" },
          ].map((s, i) => (
            <div key={i} className="bg-white/5 backdrop-blur rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-white/10 text-center">
              <div className={`text-xl sm:text-3xl font-black ${s.c}`}>{s.v}</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5">{s.l}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 mb-4 sm:mb-6 bg-white/5 rounded-xl p-0.5 sm:p-1 border border-white/10 overflow-x-auto">
          {([
            { id: "history", l: "📋 紀錄" },
            { id: "stats", l: "📈 統計" },
            { id: "leaderboard", l: "🏆 排行" },
            { id: "achievements", l: "🎖️ 成就" },
          ] as const).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 py-2 px-2 sm:px-3 rounded-lg text-[10px] sm:text-sm font-medium transition whitespace-nowrap ${tab === t.id ? "bg-white/15 text-white shadow" : "text-gray-400 hover:text-gray-300"}`}>
              {t.l}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-400 text-sm">載入中...</p>
          </div>
        ) : (
          <>
            {tab === "history" && (
              <div className="space-y-2 sm:space-y-3">
                {sessions.length === 0 ? (
                  <div className="text-center py-12 sm:py-16 bg-white/5 rounded-2xl border border-white/10">
                    <span className="text-4xl sm:text-5xl mb-3 block">🏃‍♂️</span>
                    <p className="text-base sm:text-lg font-semibold text-gray-300">還沒有訓練紀錄</p>
                    <a href="/workout" className="inline-block mt-3 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 font-medium text-xs sm:text-sm">開始運動</a>
                  </div>
                ) : sessions.map((s) => (
                  <div key={s.id} className="bg-white/5 backdrop-blur rounded-xl sm:rounded-2xl p-3 sm:p-5 border border-white/10">
                    <div className="flex items-center justify-between mb-2 sm:mb-3 flex-wrap gap-1">
                      <div className="text-xs sm:text-sm text-gray-400">{fmtDate(s.startedAt)}</div>
                      <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                        <span className="text-cyan-400 font-bold">{s.totalReps} 次</span>
                        <span className="text-gray-500">·</span>
                        <span className="text-purple-400">{fmt(s.totalDuration || 0)}</span>
                        <span className="text-gray-500">·</span>
                        <span className={(s.avgQuality || 0) > 75 ? "text-green-400" : (s.avgQuality || 0) > 50 ? "text-yellow-400" : "text-red-400"}>
                          {Math.round(s.avgQuality || 0)}%
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.exercises.map((ex) => {
                        const ei = exInfo(ex.exerciseType);
                        return <div key={ex.id} className="bg-white/5 rounded-lg px-2 py-1 text-[10px] sm:text-xs flex items-center gap-1">{ei.icon} {ei.nameZh} <span className="text-cyan-400 font-bold">{ex.reps}次</span></div>;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "stats" && (
              <div className="space-y-2 sm:space-y-3">
                {daily.length === 0 ? (
                  <div className="text-center py-12 bg-white/5 rounded-2xl border border-white/10">
                    <span className="text-4xl mb-3 block">📊</span>
                    <p className="text-sm text-gray-400">尚無每日統計</p>
                  </div>
                ) : (
                  <>
                    <div className="bg-white/5 backdrop-blur rounded-xl sm:rounded-2xl p-3 sm:p-5 border border-white/10">
                      <h3 className="text-xs sm:text-sm font-bold text-gray-300 mb-3">每日運動量</h3>
                      <div className="flex items-end gap-1 h-24 sm:h-32">
                        {daily.slice(0, 14).reverse().map((s) => {
                          const mx = Math.max(...daily.map((d) => d.totalReps || 1));
                          const h = ((s.totalReps || 0) / mx) * 100;
                          return (
                            <div key={s.id} className="flex-1 flex flex-col items-center gap-0.5">
                              <div className="text-[8px] sm:text-[10px] text-gray-500">{s.totalReps}</div>
                              <div className="w-full bg-gradient-to-t from-cyan-500 to-blue-500 rounded-t-sm min-h-[3px]" style={{ height: `${Math.max(h, 3)}%` }} />
                              <div className="text-[8px] sm:text-[9px] text-gray-600">{new Date(s.dateStr).getDate()}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {daily.map((s) => (
                      <div key={s.id} className="bg-white/5 backdrop-blur rounded-xl p-3 sm:p-4 border border-white/10 flex items-center justify-between">
                        <div><div className="text-xs sm:text-sm font-medium">{fmtDate(s.dateStr)}</div><div className="text-[10px] text-gray-400">🔥 連續 {s.streakDays} 天</div></div>
                        <div className="flex items-center gap-3 text-xs sm:text-sm"><span className="text-cyan-400 font-bold">{s.totalReps} 次</span><span className="text-purple-400">{fmt(s.totalDuration || 0)}</span></div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {tab === "leaderboard" && (
              <div className="space-y-1.5 sm:space-y-2">
                {lb.length === 0 ? (
                  <div className="text-center py-12 bg-white/5 rounded-2xl border border-white/10">
                    <span className="text-4xl mb-3 block">🏆</span>
                    <p className="text-sm text-gray-400">排行榜尚無數據</p>
                  </div>
                ) : lb.map((e) => (
                  <div key={e.rank} className={`flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border ${e.rank <= 3 ? "bg-yellow-500/5 border-yellow-500/20" : "bg-white/5 border-white/10"}`}>
                    <div className="text-xl sm:text-2xl font-black w-8 text-center">{e.rank <= 3 ? ["🥇", "🥈", "🥉"][e.rank - 1] : `#${e.rank}`}</div>
                    <div className="flex-1 min-w-0"><div className="text-xs sm:text-sm font-medium truncate">{e.displayName}</div><div className="text-[10px] text-gray-400">{e.totalSessions} 次訓練</div></div>
                    <div className="text-right flex-shrink-0"><div className="text-cyan-400 font-bold text-xs sm:text-sm">{e.totalReps} 次</div><div className="text-[10px] text-gray-400">品質 {e.avgQuality}%</div></div>
                  </div>
                ))}
              </div>
            )}

            {tab === "achievements" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                {achs.map((a) => (
                  <div key={a.id} className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl border ${a.ok ? "bg-yellow-500/10 border-yellow-500/30" : "bg-white/5 border-white/10 opacity-50"}`}>
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className={`text-2xl sm:text-3xl ${a.ok ? "" : "grayscale"}`}>{a.title.split(" ")[0]}</div>
                      <div>
                        <div className="font-medium text-xs sm:text-sm">{a.title.split(" ").slice(1).join(" ")}</div>
                        <div className="text-[10px] sm:text-xs text-gray-400">{a.desc}</div>
                        {a.ok && <div className="text-[10px] text-yellow-400 mt-0.5">✅ 已解鎖</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
