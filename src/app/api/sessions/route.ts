import { db } from "@/db";
import { workoutSessions } from "@/db/schema";
import { desc } from "drizzle-orm";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// 取得所有運動紀錄（最新在前）
export async function GET() {
  try {
    const rows = await db
      .select()
      .from(workoutSessions)
      .orderBy(desc(workoutSessions.createdAt))
      .limit(1000);
    return Response.json({ ok: true, sessions: rows });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: "讀取失敗" }, { status: 500 });
  }
}

// 新增一筆運動紀錄
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const exercise = String(body.exercise ?? "");
    const reps = Math.max(0, Math.round(Number(body.reps ?? 0)));
    const durationSeconds = Math.max(
      0,
      Math.round(Number(body.durationSeconds ?? 0)),
    );
    const calories = Math.max(0, Number(body.calories ?? 0));

    if (!exercise) {
      return Response.json(
        { ok: false, error: "缺少運動類型" },
        { status: 400 },
      );
    }
    // 沒有任何有效資料則不儲存
    if (reps === 0 && durationSeconds < 3) {
      return Response.json(
        { ok: false, error: "運動資料不足，未儲存" },
        { status: 400 },
      );
    }

    const today = new Date();
    const workoutDate = today.toISOString().slice(0, 10);

    const [row] = await db
      .insert(workoutSessions)
      .values({
        exercise,
        reps,
        durationSeconds,
        calories,
        workoutDate,
      })
      .returning();

    return Response.json({ ok: true, session: row });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: "儲存失敗" }, { status: 500 });
  }
}
