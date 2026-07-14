import { type SQL, sql } from "drizzle-orm";

import type { DeployTaskStatus } from "../schema";

export const TASKS = sql.raw(`"sealai_deployment"."deploy_tasks"`);
export const EVENTS = sql.raw(`"sealai_deployment"."deploy_task_events"`);

export const RETURNING_LITE = sql.raw(
  `"id", "namespace", "project_uid", "status", "lease_epoch", "cancel_requested_at"`
);

export interface DeployTaskRowLite {
  cancelRequestedAt: Date | null;
  leaseEpoch: number;
  namespace: string;
  projectId: string | null;
  status: DeployTaskStatus;
  taskId: string;
}

export function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }
  if (
    typeof result === "object" &&
    result != null &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

export function dateOf(value: unknown): Date | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function liteOf(record: Record<string, unknown>): DeployTaskRowLite {
  return {
    cancelRequestedAt: dateOf(record.cancel_requested_at),
    leaseEpoch: Number(record.lease_epoch ?? 0),
    namespace: String(record.namespace ?? ""),
    projectId: record.project_uid == null ? null : String(record.project_uid),
    status: String(record.status) as DeployTaskStatus,
    taskId: String(record.id),
  };
}

export function statusListSql(statuses: readonly DeployTaskStatus[]): SQL {
  return sql.join(
    statuses.map((status) => sql`${status}`),
    sql`, `
  );
}

export function jsonbParam(value: unknown): SQL {
  return sql`${JSON.stringify(value)}::jsonb`;
}

export function intervalFromMs(ms: number): SQL {
  return sql`make_interval(secs => ${ms / 1000})`;
}
