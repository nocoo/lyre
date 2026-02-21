import { defineConfig } from "drizzle-kit";

const dbUrl = process.env.LYRE_DB
  ? `./${process.env.LYRE_DB}`
  : "./database/lyre.db";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbUrl,
  },
});
