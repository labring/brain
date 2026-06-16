import "server-only";

import type { Pool } from "pg";

import { getAppPostgresPool } from "@/lib/app-postgres/db";

import { PROJECT_DB_SCHEMA } from "./types";

let schemaReadyPromise: Promise<void> | undefined;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function qualifiedTable(schemaName: string, tableName: string): string {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

async function ensureProjectTables(pool: Pool): Promise<void> {
  const projects = qualifiedTable(PROJECT_DB_SCHEMA, "projects");

  await pool.query(`
    create schema if not exists ${quoteIdentifier(PROJECT_DB_SCHEMA)};

    create table if not exists ${projects} (
      namespace text not null,
      id text not null,
      display_name text not null,
      description text not null default '',
      updated_at timestamp with time zone not null default now(),
      created_at timestamp with time zone not null default now(),
      constraint projects_pk primary key (namespace, id)
    );

    create unique index if not exists projects_namespace_display_name_idx
      on ${projects} (namespace, display_name);
    create index if not exists projects_updated_at_idx
      on ${projects} (updated_at);
  `);
}

async function migrateProjectTableShape(pool: Pool): Promise<void> {
  const projects = qualifiedTable(PROJECT_DB_SCHEMA, "projects");

  await pool.query(`
    alter table ${projects}
      add column if not exists description text;
    update ${projects}
      set description = ''
      where description is null;
    alter table ${projects}
      alter column description set default '',
      alter column description set not null;
  `);
}

async function ensureProjectStorageSchemaOnce(): Promise<void> {
  const pool = getAppPostgresPool();
  await ensureProjectTables(pool);
  await migrateProjectTableShape(pool);
}

export function ensureProjectStorageSchema(): Promise<void> {
  schemaReadyPromise ??= ensureProjectStorageSchemaOnce().catch((error) => {
    schemaReadyPromise = undefined;
    throw error;
  });
  return schemaReadyPromise;
}
