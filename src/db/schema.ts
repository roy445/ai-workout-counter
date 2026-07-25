import {
  pgTable,
  serial,
  varchar,
  integer,
  real,
  date,
  timestamp,
} from "drizzle-orm/pg-core";

// 每一筆運動 session 紀錄
export const workoutSessions = pgTable("workout_sessions", {
  id: serial("id").primaryKey(),
  // 運動類型代碼，例如 squat / pushup / situp / jumpingjack / jump / plank / march
  exercise: varchar("exercise", { length: 32 }).notNull(),
  // 完成次數（平板支撐等以時間為主的運動 reps 為 0）
  reps: integer("reps").notNull().default(0),
  // 運動持續秒數
  durationSeconds: integer("duration_seconds").notNull().default(0),
  // 估算消耗熱量（kcal）
  calories: real("calories").notNull().default(0),
  // 記錄日期（YYYY-MM-DD，方便依日彙整）
  workoutDate: date("workout_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WorkoutSession = typeof workoutSessions.$inferSelect;
export type NewWorkoutSession = typeof workoutSessions.$inferInsert;
