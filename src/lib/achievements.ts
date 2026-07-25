// 成就徽章系統：依據累計統計判定解鎖狀態

export type Achievement = {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  unlocked: boolean;
  progress: number; // 0~1
};

export type AchievementInput = {
  totalReps: number;
  totalCalories: number;
  totalSeconds: number;
  streak: number;
  workoutDays: number;
  distinctExercises: number;
  sessions: number;
};

export function computeAchievements(s: AchievementInput): Achievement[] {
  const mk = (
    id: string,
    emoji: string,
    name: string,
    desc: string,
    value: number,
    goal: number,
  ): Achievement => ({
    id,
    emoji,
    name,
    desc,
    unlocked: value >= goal,
    progress: Math.max(0, Math.min(1, value / goal)),
  });

  return [
    mk("first", "🎬", "踏出第一步", "完成第一次訓練", s.sessions, 1),
    mk("reps100", "💯", "百下達成", "累計完成 100 下", s.totalReps, 100),
    mk("reps1000", "🔩", "千錘百鍊", "累計完成 1000 下", s.totalReps, 1000),
    mk("cal500", "🔥", "燃脂新手", "累計消耗 500 大卡", s.totalCalories, 500),
    mk("cal2000", "🌋", "燃脂達人", "累計消耗 2000 大卡", s.totalCalories, 2000),
    mk("streak3", "⚡", "三日不輟", "連續運動 3 天", s.streak, 3),
    mk("streak7", "📅", "一週堅持", "連續運動 7 天", s.streak, 7),
    mk("streak30", "👑", "月度傳奇", "連續運動 30 天", s.streak, 30),
    mk("all", "🎯", "全能玩家", "體驗全部 7 種運動", s.distinctExercises, 7),
    mk("time60", "⏱️", "耐力初成", "累計運動 60 分鐘", s.totalSeconds, 3600),
    mk("days10", "🗓️", "習慣養成", "累計運動 10 天", s.workoutDays, 10),
    mk("sessions50", "🏅", "訓練狂人", "完成 50 組訓練", s.sessions, 50),
  ];
}
