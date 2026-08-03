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
const regionsResponseSchema = z.object({
  regions: z.array(z.object({ uid: z.string().trim().min(1) })),
});
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

  const [regionsPayload, workspacesPayload] = await Promise.all([
    requestBillingJson("/api/billing/regions"),
    requestBillingJson("/api/billing/workspaces", {
      endTime,
      startTime,
      type: 0,
    }),
  ]);
  const regions = regionsResponseSchema.parse(regionsPayload).regions;
  if (regions.length === 0) {
    throw new Error("Billing region is unavailable.");
  }

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

  const quotaPayload = await requestBillingJson(
    "/api/billing/workspace-quota",
    {
      workspace: selectedWorkspace,
    }
  );
  return {
    rows: quotaRows(quotaResponseSchema.parse(quotaPayload)),
    selectedWorkspace,
    workspaces,
  };
}
