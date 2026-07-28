import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workoutSessions, exerciseRecords, dailyStats } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { totalDuration, totalReps, avgQuality, exercises } = body;

    // Create workout session
    const [session] = await db
      .insert(workoutSessions)
      .values({
        totalDuration: totalDuration || 0,
        totalReps: totalReps || 0,
        avgQuality: avgQuality || 0,
        endedAt: new Date(),
      })
      .returning();

    // Create exercise records
    if (exercises && exercises.length > 0) {
      for (const ex of exercises) {
        await db.insert(exerciseRecords).values({
          sessionId: session.id,
          exerciseType: ex.type,
          reps: ex.reps || 0,
          duration: ex.duration || 0,
          avgQuality: ex.quality || 0,
          feedbackSummary: ex.feedbackSummary || "",
        });
      }
    }

    // Update daily stats
    const today = new Date().toISOString().split("T")[0];
    const existingStats = await db
      .select()
      .from(dailyStats)
      .where(eq(dailyStats.dateStr, today))
      .limit(1);

    if (existingStats.length > 0) {
      await db
        .update(dailyStats)
        .set({
          totalReps: sql`${dailyStats.totalReps} + ${totalReps || 0}`,
          totalDuration: sql`${dailyStats.totalDuration} + ${totalDuration || 0}`,
          exerciseTypes: (existingStats[0].exerciseTypes || "") +
            "," +
            (exercises || []).map((e: { type: string }) => e.type).join(","),
        })
        .where(eq(dailyStats.dateStr, today));
    } else {
      // Calculate streak
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];
      const yesterdayStats = await db
        .select()
        .from(dailyStats)
        .where(eq(dailyStats.dateStr, yesterdayStr))
        .limit(1);

      const streak = yesterdayStats.length > 0 ? (yesterdayStats[0].streakDays || 0) + 1 : 1;

      await db.insert(dailyStats).values({
        dateStr: today,
        totalReps: totalReps || 0,
        totalDuration: totalDuration || 0,
        exerciseTypes: (exercises || [])
          .map((e: { type: string }) => e.type)
          .join(","),
        streakDays: streak,
      });
    }

    return NextResponse.json({ success: true, sessionId: session.id });
  } catch (error) {
    console.error("Error saving workout:", error);
    return NextResponse.json(
      { error: "Failed to save workout" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Get recent sessions with their exercises
    const sessions = await db
      .select()
      .from(workoutSessions)
      .orderBy(desc(workoutSessions.startedAt))
      .limit(20);

    const sessionIds = sessions.map((s) => s.id);

    let exercises: (typeof exerciseRecords.$inferSelect)[] = [];
    if (sessionIds.length > 0) {
      exercises = await db
        .select()
        .from(exerciseRecords)
        .where(
          sql`${exerciseRecords.sessionId} IN (${sql.join(
            sessionIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        );
    }

    // Get daily stats
    const stats = await db
      .select()
      .from(dailyStats)
      .orderBy(desc(dailyStats.dateStr))
      .limit(30);

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        ...s,
        exercises: exercises.filter((e) => e.sessionId === s.id),
      })),
      dailyStats: stats,
    });
  } catch (error) {
    console.error("Error fetching workouts:", error);
    return NextResponse.json(
      { error: "Failed to fetch workouts" },
      { status: 500 }
    );
  }
}
