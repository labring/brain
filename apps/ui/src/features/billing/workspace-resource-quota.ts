import { Quantity } from "@workspace/shared";
import { z } from "zod";

const quantityValueSchema = z.union([z.string(), z.number()]);
const workspaceResourceQuotaResponseSchema = z.object({
  quota: z.object({
    hard: z.record(z.string(), quantityValueSchema).optional().default({}),
    used: z.record(z.string(), quantityValueSchema).optional().default({}),
  }),
});

const RESOURCE_ROWS = [
  { keys: ["limits.cpu"], label: "CPU", type: "cpu" },
  { keys: ["limits.memory"], label: "Memory", type: "binary" },
  { keys: ["requests.storage"], label: "Storage", type: "binary" },
  { keys: ["pods", "count/pods"], label: "Pods", type: "integer" },
  { keys: ["services.nodeports"], label: "Ports", type: "integer" },
] as const;

export type WorkspaceResourceQuotaRow = readonly [
  label: (typeof RESOURCE_ROWS)[number]["label"],
  value: string,
];

export interface WorkspaceResourceQuotaSnapshot {
  rows: WorkspaceResourceQuotaRow[];
  status: "available" | "unavailable";
}

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

function quantityValue(
  value: string | number | undefined,
  format: "BinarySI" | "DecimalSI"
): string | null {
  if (value === undefined) {
    return null;
  }
  try {
    const quantity = Quantity.fromJSON(value);
    if (quantity.cmp(Quantity.ZERO) < 0) {
      return null;
    }
    return quantity.formatForDisplay({ digits: 2, format });
  } catch {
    return null;
  }
}

function integerValue(value: string | number | undefined): string | null {
  if (
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0
    ? String(parsed)
    : null;
}

function formatPair(
  used: string | number | undefined,
  hard: string | number | undefined,
  type: (typeof RESOURCE_ROWS)[number]["type"]
): string {
  const format = (value: string | number | undefined) => {
    if (type === "integer") {
      return integerValue(value);
    }
    const rendered = quantityValue(
      value,
      type === "binary" ? "BinarySI" : "DecimalSI"
    );
    return rendered == null || type !== "cpu" ? rendered : `${rendered}C`;
  };
  const renderedUsed = format(used);
  const renderedHard = format(hard);
  return renderedUsed == null || renderedHard == null
    ? "--/--"
    : `${renderedUsed}/${renderedHard}`;
}

export function unavailableWorkspaceResourceQuota(): WorkspaceResourceQuotaSnapshot {
  return {
    rows: RESOURCE_ROWS.map(({ label }) => [label, "--/--"]),
    status: "unavailable",
  };
}

export function parseWorkspaceResourceQuotaPayload(
  payload: unknown
): WorkspaceResourceQuotaSnapshot {
  const parsed = workspaceResourceQuotaResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Workspace resource quota response is invalid.");
  }
  const { hard, used } = parsed.data.quota;
  return {
    rows: RESOURCE_ROWS.map(({ keys, label, type }) => [
      label,
      formatPair(firstValue(used, keys), firstValue(hard, keys), type),
    ]),
    status: "available",
  };
}
