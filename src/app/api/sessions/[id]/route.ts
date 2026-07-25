import { db } from "@/db";
import { workoutSessions } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const numId = Number(id);
    if (!Number.isFinite(numId)) {
      return Response.json({ ok: false, error: "無效 ID" }, { status: 400 });
    }
    await db.delete(workoutSessions).where(eq(workoutSessions.id, numId));
    return Response.json({ ok: true });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: "刪除失敗" }, { status: 500 });
  }
}
