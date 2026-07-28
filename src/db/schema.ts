import {
  pgTable,
  serial,
  varchar,
  integer,
  real,
  text,
  timestamp,
  date,
} from "drizzle-orm/pg-core";

export const workoutSessions = pgTable("workout_sessions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).default("anonymous").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  totalDuration: integer("total_duration").default(0),
  totalReps: integer("total_reps").default(0),
  avgQuality: real("avg_quality").default(0),
});

export const exerciseRecords = pgTable("exercise_records", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => workoutSessions.id),
  exerciseType: varchar("exercise_type", { length: 50 }).notNull(),
  reps: integer("reps").default(0),
  duration: integer("duration").default(0),
  avgQuality: real("avg_quality").default(0),
  feedbackSummary: text("feedback_summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const dailyStats = pgTable("daily_stats", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).default("anonymous").notNull(),
  dateStr: date("date_str").defaultNow().notNull(),
  totalReps: integer("total_reps").default(0),
  totalDuration: integer("total_duration").default(0),
  exerciseTypes: text("exercise_types").default(""),
  streakDays: integer("streak_days").default(1),
});

export const achievements = pgTable("achievements", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).default("anonymous").notNull(),
  achievementType: varchar("achievement_type", { length: 100 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  unlockedAt: timestamp("unlocked_at").defaultNow().notNull(),
});

export const leaderboard = pgTable("leaderboard", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  totalReps: integer("total_reps").default(0),
  totalDuration: integer("total_duration").default(0),
  totalSessions: integer("total_sessions").default(0),
  bestStreak: integer("best_streak").default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// WebRTC signaling for multi-camera
export const signaling = pgTable("signaling", {
  id: serial("id").primaryKey(),
  roomId: varchar("room_id", { length: 20 }).notNull(),
  sender: varchar("sender", { length: 20 }).notNull(),
  msgType: varchar("msg_type", { length: 30 }).notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
