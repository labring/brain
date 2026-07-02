import dotenv from "dotenv";
import pg from "pg";

const { Client } = pg;

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is empty. Check apps/ui/.env.local or .env.");
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();

  const {
    rows: [{ database }],
  } = await client.query("select current_database() as database");

  console.log(`Resetting local app schemas in database: ${database}`);

  await client.query(`
    DROP SCHEMA IF EXISTS
      sealai_assistant,
      sealai_deployment,
      sealai_project,
      drizzle
    CASCADE;
  `);

  console.log("Local database schemas reset.");
} finally {
  await client.end().catch(() => undefined);
}
