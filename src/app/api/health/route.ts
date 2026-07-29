import { db } from "@/db";
import { ensureDatabaseSchema } from "@/db/bootstrap";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

function classifyDatabaseError(error: unknown): string {
  const value = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const code = value?.code || value?.cause?.code || "";
  const message = `${value?.message || ""} ${value?.cause?.message || ""}`.toLowerCase();

  if (code === "28P01" || message.includes("password authentication failed")) {
    return "AUTHENTICATION_FAILED";
  }
  if (code === "3D000" || message.includes("database does not exist")) {
    return "DATABASE_NOT_FOUND";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "DATABASE_HOST_NOT_FOUND";
  }
  if (code === "ETIMEDOUT" || message.includes("timeout")) {
    return "CONNECTION_TIMEOUT";
  }
  if (code === "ECONNREFUSED") {
    return "CONNECTION_REFUSED";
  }
  if (message.includes("ssl") || message.includes("certificate")) {
    return "SSL_ERROR";
  }
  return code ? `DATABASE_ERROR_${code}` : "DATABASE_CONNECTION_FAILED";
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return Response.json(
      {
        ok: false,
        code: "MISSING_DATABASE_URL",
        hint: "Add DATABASE_URL to the Vercel Production environment, then redeploy.",
      },
      { status: 503, headers },
    );
  }

  try {
    // Automatically boot all schemas on first request
    await ensureDatabaseSchema();
    await db.execute(sql`select 1`);

    return Response.json(
      {
        ok: true,
        database: "connected",
        schema: "boostrapped",
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      },
      { headers },
    );
  } catch (error) {
    const code = classifyDatabaseError(error);
    console.error("Database health check failed:", error);
    return Response.json(
      {
        ok: false,
        code,
        hint:
          code === "AUTHENTICATION_FAILED"
            ? "Replace DATABASE_URL with your correct password in Vercel."
            : code === "DATABASE_HOST_NOT_FOUND"
              ? "The hostname in DATABASE_URL is invalid. Reconnect your Supabase integration."
              : code === "SSL_ERROR"
                ? "Use the full connection string including ?sslmode=require."
                : "Check your database connection string and ensure your IP is not blocked.",
      },
      { status: 503, headers },
    );
  }
}
