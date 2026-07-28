import { NextResponse } from "next/server";
import { db } from "@/db";
import { workoutSessions, dailyStats } from "@/db/schema";
import { desc, sql } from "drizzle-orm";

export async function GET() {
  try {
    // Aggregate stats per user
    const userStats = await db
      .select({
        userId: workoutSessions.userId,
        totalReps: sql<number>`COALESCE(SUM(${workoutSessions.totalReps}), 0)`,
        totalDuration: sql<number>`COALESCE(SUM(${workoutSessions.totalDuration}), 0)`,
        totalSessions: sql<number>`COUNT(*)`,
        avgQuality: sql<number>`COALESCE(AVG(${workoutSessions.avgQuality}), 0)`,
      })
      .from(workoutSessions)
      .groupBy(workoutSessions.userId)
      .orderBy(desc(sql`SUM(${workoutSessions.totalReps})`))
      .limit(20);

    // Get streaks
    const streaks = await db
      .select({
        userId: dailyStats.userId,
        bestStreak: sql<number>`COALESCE(MAX(${dailyStats.streakDays}), 0)`,
      })
      .from(dailyStats)
      .groupBy(dailyStats.userId);

    const streakMap = new Map(
      streaks.map((s) => [s.userId, s.bestStreak])
    );

    const leaderboardData = userStats.map((u, index) => ({
      rank: index + 1,
      userId: u.userId,
      displayName: u.userId === "anonymous" ? "匿名運動員" : u.userId,
      totalReps: Number(u.totalReps),
      totalDuration: Number(u.totalDuration),
      totalSessions: Number(u.totalSessions),
      avgQuality: Math.round(Number(u.avgQuality)),
      bestStreak: streakMap.get(u.userId) || 0,
    }));

    return NextResponse.json({ leaderboard: leaderboardData });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    return NextResponse.json(
      { error: "Failed to fetch leaderboard" },
      { status: 500 }
    );
  }
}
