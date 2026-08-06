import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * Migration workflow (run from `apps/ui`):
 * - `bun run db:generate` — diff schema.ts files into `./drizzle/*.sql`
 * - `bun run db:migrate` — apply pending migrations manually (CI / operators)
 *
 * The app also applies pending migrations automatically on server start
 * (`src/instrumentation.ts` → `src/lib/app-postgres/migrate.ts`).
 *
 * `sealai_project.ap_image_versions` is owned by the Go API
 * (`apps/api/service/apversion/store.go`) and is intentionally absent from the
 * drizzle schema and migrations.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/features/chat/persistence/schema.ts",
    "./src/features/deploy/task/schema.ts",
    "./src/features/marketing/schema.ts",
    "./src/lib/project-persistence/schema.ts",
  ],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  out: "./drizzle",
});
