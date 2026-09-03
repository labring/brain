import { Quantity, Scale } from "@workspace/shared";
import { z } from "zod";
import type { WorkspaceCredentials } from "@/lib/personal-resource-headers";

import {
  type BillingCredentials,
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";
import { loadWorkspaceQuotaResponse } from "./workspace-quota-client";
import {
  ACCOUNT_SERVICE_WORKSPACE_QUOTA_RESOURCES,
  type AccountServiceWorkspaceQuotaResponse,
  type AccountServiceWorkspaceQuotaType,
  accountServiceWorkspaceQuotaResponseSchema,
  isQuantityQuotaExhausted,
  SNAPSHOT_WORKSPACE_QUOTA_RESOURCES,
  workspaceQuotaValuesForAliases,
} from "./workspace-quota-payload";
import {
  type WorkspaceResourceQuotaSnapshot,
  workspaceQuotaSnapshotFromResponse,
} from "./workspace-resource-quota";

export type BillingQuotaType = AccountServiceWorkspaceQuotaType;

export interface BillingUsageRow {
  exhausted: boolean;
  label: string;
  percentUsed: number;
  remaining: string;
  total: string;
  type: BillingQuotaType;
  used: string;
}

export interface BillingUsageSnapshot {
  rows: BillingUsageRow[];
  selectedWorkspace: string;
  workspaces: Array<{ id: string; name: string }>;
}

interface BillingUsageDependencies {
  fetch?: BillingFetch;
  now?: () => Date;
}

const workspacesResponseSchema = z.object({
  data: z.array(z.tuple([z.string().trim().min(1), z.string()])),
});
const DAYS_31_IN_MILLISECONDS = 31 * 24 * 60 * 60 * 1000;

function displayQuantity(quantity: Quantity, type: BillingQuotaType): string {
  return quantity.formatForDisplay({
    format:
      type === "memory" || type === "storage" || type === "traffic"
        ? "BinarySI"
        : "DecimalSI",
  });
}

function percentUsed(used: Quantity, limit: Quantity): number {
  if (limit.equals(Quantity.ZERO)) {
    return 0;
  }
  const ratio =
    Number(used.scaledValue(Scale.Nano)) /
    Number(limit.scaledValue(Scale.Nano));
  if (!Number.isFinite(ratio)) {
    return 0;
  }
  const rounded = Math.round(ratio * 1000) / 10;
  return rounded >= 100 && !isQuantityQuotaExhausted(used, limit)
    ? 99.9
    : rounded;
}

function quotaRows(
  response: AccountServiceWorkspaceQuotaResponse
): BillingUsageRow[] {
  const { hard, used } = response.quota;
  return ACCOUNT_SERVICE_WORKSPACE_QUOTA_RESOURCES.flatMap((resource) => {
    const { limit: hardValue, used: usedValue } =
      workspaceQuotaValuesForAliases(hard, used, resource.keys);
    if (hardValue === undefined && usedValue === undefined) {
      return [];
    }

    const limit = Quantity.fromJSON(hardValue ?? "0");
    const consumed = Quantity.fromJSON(usedValue ?? "0");
    return [
      {
        exhausted: isQuantityQuotaExhausted(consumed, limit),
        label: resource.label,
        percentUsed: percentUsed(consumed, limit),
        remaining: displayQuantity(limit.sub(consumed), resource.type),
        total: displayQuantity(limit, resource.type),
        type: resource.type,
        used: displayQuantity(consumed, resource.type),
      },
    ];
  });
}

/**
 * The quota rows a deployment can actually run into (design spec catalog
 * A1/A2): the resources a new workload asks for. Traffic and GPU stay out.
 */
export const DEPLOYABLE_QUOTA_TYPES: ReadonlySet<BillingQuotaType> = new Set(
  SNAPSHOT_WORKSPACE_QUOTA_RESOURCES.map(({ type }) => type)
);

export type QuotaFullnessRow = Pick<
  BillingUsageRow,
  "label" | "percentUsed" | "type"
> &
  Partial<Pick<BillingUsageRow, "exhausted">>;

/** Exact account-service judgment, with a legacy percentage fallback. */
export function isQuotaFullnessRowExhausted(row: QuotaFullnessRow): boolean {
  return row.exhausted ?? row.percentUsed >= 100;
}

/** "CPU" keeps its initialism mid-sentence; the rest read as common nouns. */
export function quotaResourceNoun(label: string): string {
  return label === label.toUpperCase() ? label : label.toLowerCase();
}

/** The first deployable quota row at or past its ceiling, if any. */
export function firstFullQuotaRow<Row extends QuotaFullnessRow>(
  rows: readonly Row[]
): Row | null {
  return (
    rows.find(
      (row) =>
        DEPLOYABLE_QUOTA_TYPES.has(row.type) && isQuotaFullnessRowExhausted(row)
    ) ?? null
  );
}

/**
 * The deployable quotas every new workload consumes whatever its shape — a
 * full one dooms all deployment work, so only these speak through the
 * Deploy Billing Notice (ADR-0070). Storage and nodeport doom only
 * workloads that request them; they speak through form validation instead.
 */
export const UNIVERSAL_DEPLOYABLE_QUOTA_TYPES: ReadonlySet<BillingQuotaType> =
  new Set(["cpu", "memory", "pod"]);

/**
 * The first full quota row that dooms every deployment a pane could start:
 * the universal set plus any types the pane's every deploy request consumes
 * (ADR-0070) — the database pane's presets all include storage.
 */
export function firstDoomingQuotaRow<Row extends QuotaFullnessRow>(
  rows: readonly Row[],
  paneConsumes: readonly BillingQuotaType[] = []
): Row | null {
  return (
    rows.find(
      (row) =>
        (UNIVERSAL_DEPLOYABLE_QUOTA_TYPES.has(row.type) ||
          paneConsumes.includes(row.type)) &&
        isQuotaFullnessRowExhausted(row)
    ) ?? null
  );
}

/**
 * The quota rows of a raw account-service resource-quota payload, or null
 * when the payload is not one — for server-side judgments that hold the
 * upstream response rather than a fetcher.
 */
export function workspaceQuotaRowsFromPayload(
  payload: unknown
): BillingUsageRow[] | null {
  const parsed = accountServiceWorkspaceQuotaResponseSchema.safeParse(payload);
  return parsed.success ? quotaRows(parsed.data) : null;
}

export interface WorkspaceQuotaData {
  rows: BillingUsageRow[];
  snapshot: WorkspaceResourceQuotaSnapshot | undefined;
}

/** Derives every client quota view from one parsed account-service payload. */
export async function loadWorkspaceQuotaData(
  credentials: WorkspaceCredentials,
  fetch: BillingFetch = globalThis.fetch
): Promise<WorkspaceQuotaData> {
  const response = await loadWorkspaceQuotaResponse(credentials, fetch);
  return {
    rows: quotaRows(response),
    snapshot: workspaceQuotaSnapshotFromResponse(response),
  };
}

/**
 * One workspace's quota rows from the proxied resource-quota read — the
 * Usage view's table without its workspace picker, for surfaces that only
 * judge fullness (the status hint's quota-full evaluation).
 */
export async function loadWorkspaceQuotaUsage(
  credentials: WorkspaceCredentials,
  fetch: BillingFetch = globalThis.fetch
): Promise<BillingUsageRow[]> {
  return (await loadWorkspaceQuotaData(credentials, fetch)).rows;
}

export async function loadBillingUsage(
  input: BillingCredentials & { workspace: string },
  dependencies: BillingUsageDependencies = {}
): Promise<BillingUsageSnapshot> {
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now?.() ?? new Date();
  const credentials = {
    appToken: input.appToken,
    kubeconfig: input.kubeconfig,
  };
  const requestBillingJson = createBillingJsonRequester({
    credentials,
    fallbackErrorMessage: "Could not load workspace usage.",
    fetch,
  });
  const startTime = new Date(
    now.getTime() - DAYS_31_IN_MILLISECONDS
  ).toISOString();
  const endTime = now.toISOString();

  const workspacesPayload = await requestBillingJson(
    "/api/billing/workspaces",
    {
      endTime,
      startTime,
      type: 0,
    }
  );

  const workspaces = workspacesResponseSchema
    .parse(workspacesPayload)
    .data.map(([id, name]) => ({ id, name: name.trim() || id }));
  const selectedWorkspace = workspaces.some(
    (workspace) => workspace.id === input.workspace
  )
    ? input.workspace
    : (workspaces[0]?.id ?? "");
  if (selectedWorkspace === "") {
    return { rows: [], selectedWorkspace, workspaces };
  }

  return {
    rows: await loadWorkspaceQuotaUsage(
      { ...credentials, namespace: selectedWorkspace },
      fetch
    ),
    selectedWorkspace,
    workspaces,
  };
}
