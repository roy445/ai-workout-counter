import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { signaling } from "@/db/schema";
import { eq, and, gt, desc } from "drizzle-orm";

// POST – store a signaling message
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { roomId, sender, msgType, data } = body;

    if (!roomId || !sender || !msgType || !data) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    await db.insert(signaling).values({
      roomId,
      sender,
      msgType,
      data: typeof data === "string" ? data : JSON.stringify(data),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Signal POST error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// GET – poll for signaling messages
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get("roomId");
    const notFrom = searchParams.get("notFrom"); // exclude messages from self
    const afterId = parseInt(searchParams.get("afterId") || "0", 10);

    if (!roomId) {
      return NextResponse.json({ error: "roomId required" }, { status: 400 });
    }

    const conditions = [eq(signaling.roomId, roomId)];
    if (afterId > 0) {
      conditions.push(gt(signaling.id, afterId));
    }
    if (notFrom) {
      // We'll filter in JS since drizzle doesn't have neq easily inline
    }

    let messages = await db
      .select()
      .from(signaling)
      .where(and(...conditions))
      .orderBy(desc(signaling.id))
      .limit(50);

    if (notFrom) {
      messages = messages.filter((m) => m.sender !== notFrom);
    }

    return NextResponse.json({ messages });
  } catch (error) {
    console.error("Signal GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// DELETE – clean up room
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get("roomId");
    if (!roomId) {
      return NextResponse.json({ error: "roomId required" }, { status: 400 });
    }
    await db.delete(signaling).where(eq(signaling.roomId, roomId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Signal DELETE error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
