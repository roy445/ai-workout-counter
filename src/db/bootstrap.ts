import { db } from "./index";
import { sql } from "drizzle-orm";

let bootstrapPromise: Promise<void> | null = null;

export function ensureDatabaseSchema(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      // 1. workout_sessions
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "workout_sessions" (
          "id" serial PRIMARY KEY NOT NULL,
          "user_id" varchar(255) DEFAULT 'anonymous' NOT NULL,
          "started_at" timestamp DEFAULT now() NOT NULL,
          "ended_at" timestamp,
          "total_duration" integer DEFAULT 0,
          "total_reps" integer DEFAULT 0,
          "avg_quality" real DEFAULT 0
        )
      `);

      // 2. exercise_records
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "exercise_records" (
          "id" serial PRIMARY KEY NOT NULL,
          "session_id" integer,
          "exercise_type" varchar(50) NOT NULL,
          "reps" integer DEFAULT 0,
          "duration" integer DEFAULT 0,
          "avg_quality" real DEFAULT 0,
          "feedback_summary" text,
          "created_at" timestamp DEFAULT now() NOT NULL
        )
      `);

      // 3. daily_stats
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "daily_stats" (
          "id" serial PRIMARY KEY NOT NULL,
          "user_id" varchar(255) DEFAULT 'anonymous' NOT NULL,
          "date_str" date DEFAULT now() NOT NULL,
          "total_reps" integer DEFAULT 0,
          "total_duration" integer DEFAULT 0,
          "exercise_types" text DEFAULT '',
          "streak_days" integer DEFAULT 1
        )
      `);

      // 4. achievements
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "achievements" (
          "id" serial PRIMARY KEY NOT NULL,
          "user_id" varchar(255) DEFAULT 'anonymous' NOT NULL,
          "achievement_type" varchar(100) NOT NULL,
          "title" varchar(255) NOT NULL,
          "description" text,
          "unlocked_at" timestamp DEFAULT now() NOT NULL
        )
      `);

      // 5. leaderboard
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "leaderboard" (
          "id" serial PRIMARY KEY NOT NULL,
          "user_id" varchar(255) NOT NULL,
          "display_name" varchar(100) NOT NULL,
          "total_reps" integer DEFAULT 0,
          "total_duration" integer DEFAULT 0,
          "total_sessions" integer DEFAULT 0,
          "best_streak" integer DEFAULT 0,
          "updated_at" timestamp DEFAULT now() NOT NULL
        )
      `);

      // 6. signaling
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

      // Add indexing for WebRTC rooms to keep queries lightning fast
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "signaling_room_id_id_idx"
        ON "signaling" ("room_id", "id")
      `);
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}
