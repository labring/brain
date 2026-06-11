import "server-only";

import type { Pool } from "pg";

import { getAppPostgresPool } from "@/lib/app-postgres/db";

import { ASSISTANT_DB_SCHEMA } from "./types";

let schemaReadyPromise: Promise<void> | undefined;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function qualifiedTable(tableName: string): string {
  return `${quoteIdentifier(ASSISTANT_DB_SCHEMA)}.${quoteIdentifier(tableName)}`;
}

async function tableColumns(
  pool: Pool,
  tableName: string
): Promise<Set<string>> {
  const result = await pool.query<{ column_name: string }>(
    `
      select column_name
      from information_schema.columns
      where table_schema = $1 and table_name = $2
    `,
    [ASSISTANT_DB_SCHEMA, tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function createDeployTaskTables(pool: Pool): Promise<void> {
  const deployTasks = qualifiedTable("deploy_tasks");
  const deployTaskEvents = qualifiedTable("deploy_task_events");
  const deployTaskMessages = qualifiedTable("deploy_task_messages");

  await pool.query(`
    create table if not exists ${deployTasks} (
      id text primary key,
      namespace text not null,
      project_uid text,
      project_name text,
      prompt text,
      source jsonb not null,
      target jsonb not null,
      runner jsonb not null,
      status text not null,
      phase text not null,
      runtime_provider text,
      runtime_name text,
      runtime_state text,
      gateway_url text,
      gateway_session_id text,
      gateway_thread_id text,
      gateway_turn_id text,
      artifact_summary jsonb not null default '{}'::jsonb,
      blocking_inputs jsonb not null default '[]'::jsonb,
      preview_url text,
      result_url text,
      error text,
      heartbeat_at timestamp with time zone,
      started_at timestamp with time zone,
      completed_at timestamp with time zone,
      updated_at timestamp with time zone not null default now(),
      created_at timestamp with time zone not null default now()
    );

    create index if not exists deploy_tasks_namespace_updated_at_idx
      on ${deployTasks} (namespace, updated_at);
    create index if not exists deploy_tasks_project_uid_updated_at_idx
      on ${deployTasks} (project_uid, updated_at);
    create index if not exists deploy_tasks_status_updated_at_idx
      on ${deployTasks} (status, updated_at);

    create table if not exists ${deployTaskEvents} (
      task_id text not null references ${deployTasks}(id) on delete cascade,
      seq integer not null,
      kind text not null,
      phase text,
      message text,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamp with time zone not null default now(),
      constraint deploy_task_events_pk primary key (task_id, seq)
    );
    create index if not exists deploy_task_events_task_created_at_idx
      on ${deployTaskEvents} (task_id, created_at);

    create table if not exists ${deployTaskMessages} (
      id text primary key,
      task_id text not null references ${deployTasks}(id) on delete cascade,
      role text not null,
      parts jsonb not null,
      created_at timestamp with time zone not null default now()
    );
    create index if not exists deploy_task_messages_task_id_idx
      on ${deployTaskMessages} (task_id);
    create index if not exists deploy_task_messages_task_created_idx
      on ${deployTaskMessages} (task_id, created_at);
  `);
}

async function ensureDeployTaskSupportTables(pool: Pool): Promise<void> {
  const deployTasks = qualifiedTable("deploy_tasks");
  const deployTaskEvents = qualifiedTable("deploy_task_events");
  const deployTaskMessages = qualifiedTable("deploy_task_messages");

  await pool.query(`
    create table if not exists ${deployTaskEvents} (
      task_id text not null references ${deployTasks}(id) on delete cascade,
      seq integer not null,
      kind text not null,
      phase text,
      message text,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamp with time zone not null default now(),
      constraint deploy_task_events_pk primary key (task_id, seq)
    );
    create index if not exists deploy_task_events_task_created_at_idx
      on ${deployTaskEvents} (task_id, created_at);

    create table if not exists ${deployTaskMessages} (
      id text primary key,
      task_id text not null references ${deployTasks}(id) on delete cascade,
      role text not null,
      parts jsonb not null,
      created_at timestamp with time zone not null default now()
    );
    create index if not exists deploy_task_messages_task_id_idx
      on ${deployTaskMessages} (task_id);
    create index if not exists deploy_task_messages_task_created_idx
      on ${deployTaskMessages} (task_id, created_at);
  `);
}

async function migrateExistingDeployTaskTable(pool: Pool): Promise<void> {
  const deployTasks = qualifiedTable("deploy_tasks");

  await pool.query(`
    alter table ${deployTasks} add column if not exists source jsonb;
    alter table ${deployTasks} add column if not exists target jsonb;
    alter table ${deployTasks} add column if not exists runner jsonb;
  `);

  const columns = await tableColumns(pool, "deploy_tasks");
  const hasColumn = (name: string) => columns.has(name);
  const hasGithubColumns =
    hasColumn("repo_full_name") &&
    hasColumn("repo_name") &&
    hasColumn("repo_url");

  if (hasGithubColumns) {
    const repoFields = [
      "'fullName'",
      "repo_full_name",
      "'name'",
      "repo_name",
      "'url'",
      "repo_url",
    ];
    if (hasColumn("repo_id")) {
      repoFields.push("'id'", "repo_id");
    }

    const sourceFields = [
      "'kind'",
      "'github'",
      "'repo'",
      `jsonb_strip_nulls(jsonb_build_object(${repoFields.join(", ")}))`,
    ];
    if (hasColumn("branch")) {
      sourceFields.push("'branch'", "branch");
    }

    await pool.query(`
      update ${deployTasks}
      set source = jsonb_strip_nulls(jsonb_build_object(${sourceFields.join(", ")}))
      where source is null
        and nullif(repo_full_name, '') is not null
        and nullif(repo_name, '') is not null
        and nullif(repo_url, '') is not null
    `);
  }

  const promptExpr = hasColumn("prompt") ? "nullif(prompt, '')" : "null::text";
  await pool.query(`
    update ${deployTasks}
    set source = jsonb_build_object(
      'kind',
      'prompt',
      'text',
      coalesce(${promptExpr}, 'Deployment task')
    )
    where source is null
  `);

  const projectIdExpr = hasColumn("project_uid")
    ? "nullif(project_uid, '')"
    : "null::text";
  const projectNameExpr = hasColumn("project_name")
    ? "nullif(project_name, '')"
    : "null::text";
  await pool.query(`
    update ${deployTasks}
    set target = case
      when ${projectIdExpr} is not null then
        jsonb_strip_nulls(jsonb_build_object(
          'kind',
          'existingProject',
          'projectId',
          ${projectIdExpr},
          'projectName',
          ${projectNameExpr}
        ))
      else
        jsonb_build_object(
          'kind',
          'newProject',
          'displayName',
          coalesce(${projectNameExpr}, 'deployment-task')
        )
      end
    where target is null
  `);

  await pool.query(`
    update ${deployTasks}
    set runner = case
      when source->>'kind' = 'docker' then '{"kind":"direct"}'::jsonb
      when source->>'kind' = 'database' then '{"kind":"direct"}'::jsonb
      when source->>'kind' = 'template' then '{"kind":"template"}'::jsonb
      else '{"kind":"ai","runtimeProvider":"devbox","skill":"brain-github-deploy"}'::jsonb
    end
    where runner is null
  `);

  if (hasColumn("phase")) {
    await pool.query(`
      update ${deployTasks}
      set phase = case phase
        when 'runtime' then 'prepare'
        when 'workspace' then 'prepare'
        when 'analyze' then 'plan'
        when 'generate' then 'generate-artifacts'
        when 'preview' then 'verify'
        when 'ship' then 'completed'
        else phase
      end
      where phase in ('runtime', 'workspace', 'analyze', 'generate', 'preview', 'ship')
    `);
  }

  await pool.query(`
    alter table ${deployTasks}
      alter column source set not null,
      alter column target set not null,
      alter column runner set not null
  `);

  for (const oldColumn of [
    "repo_full_name",
    "repo_name",
    "repo_url",
    "repo_id",
    "branch",
    "selected_workload_uid",
  ]) {
    if (hasColumn(oldColumn)) {
      await pool.query(`
        alter table ${deployTasks}
          alter column ${quoteIdentifier(oldColumn)} drop not null
      `);
    }
  }
}

async function ensureDeployTaskStorageSchemaOnce(): Promise<void> {
  const pool = getAppPostgresPool();
  await pool.query(
    `create schema if not exists ${quoteIdentifier(ASSISTANT_DB_SCHEMA)}`
  );

  const columns = await tableColumns(pool, "deploy_tasks");
  if (columns.size === 0) {
    await createDeployTaskTables(pool);
    return;
  }

  await migrateExistingDeployTaskTable(pool);
  await ensureDeployTaskSupportTables(pool);
}

export function ensureDeployTaskStorageSchema(): Promise<void> {
  schemaReadyPromise ??= ensureDeployTaskStorageSchemaOnce().catch((error) => {
    schemaReadyPromise = undefined;
    throw error;
  });
  return schemaReadyPromise;
}
