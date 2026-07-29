import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Use DIRECT_URL (Port 5432) for migrations/pushes to bypass Supabase pooler timeouts.
// Fallback to DATABASE_URL if DIRECT_URL is not set.
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DIRECT_URL is required for Drizzle commands");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: connectionString,
  },
});