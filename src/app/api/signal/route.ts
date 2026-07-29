import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { signaling } from "@/db/schema";
import { and, asc, eq, gt, ne, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

let schemaReadyPromise: Promise<void> | null = null;

/**
 * Older deployments might have the workout tables but not the newer signaling
 * table. Bootstrap only this ephemeral signaling table on first use so remote
 * cameras work even when a manual Drizzle push was skipped.
 */
function ensureSignalingSchema(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "signaling" (
          "id" serial PRIMARY KEY NOT NULL,
          "room_id" varchar(20) NOT NULL,
          "sender" varchar(20) NOT NULL,
          "msg_type" varchar(30) NOT NULL,
          "data" text NOT NULL,
          "created_at" timestamp DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "signaling_room_id_id_idx"
        ON "signaling" ("room_id", "id")
      `);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
}

function serverError(error: unknown) {
  console.error("Signal database error:", error);
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code =
    message.includes("database_url") ||
    message.includes("connect") ||
    message.includes("password") ||
    message.includes("timeout")
      ? "DATABASE_UNAVAILABLE"
      : "SIGNALING_DATABASE_ERROR";

  return NextResponse.json(
    {
      error: "Signaling service unavailable",
      code,
      hint:
        code === "DATABASE_UNAVAILABLE"
          ? "Check DATABASE_URL in Vercel."
          : "The signaling table could not be initialized.",
    },
    { status: 503, headers: noStoreHeaders },
  );
}

// Store one WebRTC signaling message. The video itself never passes here.
export async function POST(request: NextRequest) {
  try {
    await ensureSignalingSchema();
    const body = await request.json();
    const roomId = String(body.roomId || "").trim().toUpperCase();
    const sender = String(body.sender || "").trim();
    const msgType = String(body.msgType || "").trim();
    const data =
      typeof body.data === "string" ? body.data : JSON.stringify(body.data);

    if (!/^[A-Z0-9]{4,12}$/.test(roomId) || !sender || !msgType || !data) {
      return NextResponse.json(
        { error: "Invalid signaling message" },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const [message] = await db
      .insert(signaling)
      .values({ roomId, sender, msgType, data })
      .returning({ id: signaling.id });

    return NextResponse.json(
      { ok: true, id: message.id },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return serverError(error);
  }
}

// Poll only messages newer than afterId, in their original creation order.
export async function GET(request: NextRequest) {
  try {
    await ensureSignalingSchema();
    const { searchParams } = new URL(request.url);
    const roomId = String(searchParams.get("roomId") || "")
      .trim()
      .toUpperCase();
    const notFrom = String(searchParams.get("notFrom") || "").trim();
    const afterId = Math.max(
      0,
      Number.parseInt(searchParams.get("afterId") || "0", 10) || 0,
    );

    if (!/^[A-Z0-9]{4,12}$/.test(roomId)) {
      return NextResponse.json(
        { error: "Valid roomId required" },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const conditions = [
      eq(signaling.roomId, roomId),
      gt(signaling.id, afterId),
    ];
    if (notFrom) conditions.push(ne(signaling.sender, notFrom));

    const messages = await db
      .select()
      .from(signaling)
      .where(and(...conditions))
      .orderBy(asc(signaling.id))
      .limit(100);

    return NextResponse.json({ messages }, { headers: noStoreHeaders });
  } catch (error) {
    return serverError(error);
  }
}

// The host clears stale messages before creating a fresh room.
export async function DELETE(request: NextRequest) {
  try {
    await ensureSignalingSchema();
    const { searchParams } = new URL(request.url);
    const roomId = String(searchParams.get("roomId") || "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(roomId)) {
      return NextResponse.json(
        { error: "Valid roomId required" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    await db.delete(signaling).where(eq(signaling.roomId, roomId));
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    return serverError(error);
  }
}
