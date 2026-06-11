import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

import { ASSISTANT_DB_SCHEMA } from "./src/lib/chat-persistence/types";
import { DEPLOYMENT_TASK_DB_SCHEMA } from "./src/lib/deploy-task/schema";
import { PROJECT_DB_SCHEMA } from "./src/lib/project-persistence/types";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/** Run from `apps/ui`: `bun run db:push` */
export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/lib/chat-persistence/schema.ts",
    "./src/lib/deploy-task/schema.ts",
    "./src/lib/project-persistence/schema.ts",
  ],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  out: "./drizzle",
  /** Only reconcile app-owned schemas — avoids drizzle trying to DROP `public` objects (e.g. `postgres_log`) on managed PG. */
  schemaFilter: [
    ASSISTANT_DB_SCHEMA,
    DEPLOYMENT_TASK_DB_SCHEMA,
    PROJECT_DB_SCHEMA,
  ],
  tablesFilter: [
    "!pg_auth_mon",
    "!pg_stat_kcache",
    "!pg_stat_kcache_detail",
    "!pg_stat_statements",
    "!pg_stat_statements_info",
    "!postgres_log",
  ],
});
