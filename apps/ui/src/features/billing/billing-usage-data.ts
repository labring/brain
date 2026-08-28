import { Quantity, Scale } from "@workspace/shared";
import { z } from "zod";

import {
  type BillingCredentials,
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";

export type BillingQuotaType =
  | "cpu"
  | "gpu"
  | "memory"
  | "nodeport"
  | "pod"
  | "storage"
  | "traffic";

export interface BillingUsageRow {
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

const quantityValueSchema = z.union([z.string(), z.number()]);
const workspacesResponseSchema = z.object({
  data: z.array(z.tuple([z.string().trim().min(1), z.string()])),
});
const quotaResponseSchema = z.object({
  quota: z.object({
    hard: z.record(z.string(), quantityValueSchema).optional().default({}),
    used: z.record(z.string(), quantityValueSchema).optional().default({}),
  }),
});

const DAYS_31_IN_MILLISECONDS = 31 * 24 * 60 * 60 * 1000;

const QUOTA_RESOURCES: ReadonlyArray<{
  keys: readonly string[];
  label: string;
  type: BillingQuotaType;
}> = [
  { keys: ["limits.cpu"], label: "CPU", type: "cpu" },
  { keys: ["limits.memory"], label: "Memory", type: "memory" },
  { keys: ["requests.storage"], label: "Storage", type: "storage" },
  { keys: ["pods", "count/pods"], label: "Pods", type: "pod" },
  { keys: ["services.nodeports"], label: "Ports", type: "nodeport" },
  { keys: ["traffic"], label: "Traffic", type: "traffic" },
  {
    keys: ["limits.nvidia.com/gpu", "requests.nvidia.com/gpu"],
    label: "GPU",
    type: "gpu",
  },
];

function firstValue(
  values: Record<string, string | number>,
  keys: readonly string[]
): string | number | undefined {
  for (const key of keys) {
    if (values[key] !== undefined) {
      return values[key];
    }
  }
  return undefined;
}

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
  return Number.isFinite(ratio) ? Math.round(ratio * 1000) / 10 : 0;
}

function quotaRows(
  response: z.infer<typeof quotaResponseSchema>
): BillingUsageRow[] {
  const { hard, used } = response.quota;
  return QUOTA_RESOURCES.flatMap((resource) => {
    const hardValue = firstValue(hard, resource.keys);
    const usedValue = firstValue(used, resource.keys);
    if (hardValue === undefined && usedValue === undefined) {
      return [];
    }

    const limit = Quantity.fromJSON(hardValue ?? "0");
    const consumed = Quantity.fromJSON(usedValue ?? "0");
    return [
      {
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
export const DEPLOYABLE_QUOTA_TYPES: ReadonlySet<BillingQuotaType> = new Set([
  "cpu",
  "memory",
  "storage",
  "pod",
  "nodeport",
]);

export type QuotaFullnessRow = Pick<
  BillingUsageRow,
  "label" | "percentUsed" | "type"
>;

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
      (row) => DEPLOYABLE_QUOTA_TYPES.has(row.type) && row.percentUsed >= 100
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
  const parsed = quotaResponseSchema.safeParse(payload);
  return parsed.success ? quotaRows(parsed.data) : null;
}

/**
 * One workspace's quota rows from the proxied resource-quota read — the
 * Usage view's table without its workspace picker, for surfaces that only
 * judge fullness (the status hint's quota-full evaluation).
 */
export async function loadWorkspaceQuotaUsage(
  credentials: BillingCredentials & { workspace: string },
  fetch: BillingFetch = globalThis.fetch
): Promise<BillingUsageRow[]> {
  const requestBillingJson = createBillingJsonRequester({
    credentials: {
      appToken: credentials.appToken,
      kubeconfig: credentials.kubeconfig,
    },
    fallbackErrorMessage: "Could not load workspace usage.",
    fetch,
  });
  const quotaPayload = await requestBillingJson(
    "/api/billing/workspace-quota",
    { workspace: credentials.workspace }
  );
  return quotaRows(quotaResponseSchema.parse(quotaPayload));
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
      { ...credentials, workspace: selectedWorkspace },
      fetch
    ),
    selectedWorkspace,
    workspaces,
  };
}
