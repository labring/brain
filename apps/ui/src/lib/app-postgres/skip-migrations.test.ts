import { afterEach, describe, expect, test } from "bun:test";

import { runAppPostgresMigrations } from "./migrate";

const savedSkip = process.env.APP_POSTGRES_SKIP_MIGRATIONS;
const savedUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (savedSkip === undefined) {
    delete process.env.APP_POSTGRES_SKIP_MIGRATIONS;
  } else {
    process.env.APP_POSTGRES_SKIP_MIGRATIONS = savedSkip;
  }
  if (savedUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = savedUrl;
  }
});

describe("runAppPostgresMigrations skip switch", () => {
  test.each([
    "1",
    "true",
    "TRUE",
    " 1 ",
  ])("APP_POSTGRES_SKIP_MIGRATIONS=%p returns without touching the database", async (value) => {
    process.env.APP_POSTGRES_SKIP_MIGRATIONS = value;
    // Unreachable on purpose: connecting would hang/throw, so resolving
    // proves the skip happened before any pool was created.
    process.env.DATABASE_URL =
      "postgresql://nobody:nothing@skip-migrations.invalid:5432/none";
    await expect(runAppPostgresMigrations()).resolves.toBeUndefined();
  });

  test("unset DATABASE_URL still skips without error", async () => {
    delete process.env.APP_POSTGRES_SKIP_MIGRATIONS;
    delete process.env.DATABASE_URL;
    await expect(runAppPostgresMigrations()).resolves.toBeUndefined();
  });
});
