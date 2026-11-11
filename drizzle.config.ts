import { defineConfig } from "drizzle-kit";

// Generates SQL migrations into db/migrations; wrangler applies them to D1.
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
});
