import type {
  BillingCostScope,
  BillingWorkspace,
} from "@/features/billing/billing-costs-data";

export type BillingTableBodyState = "empty" | "error" | "loading" | "rows";

/**
 * A billing table may only claim "No Data Available" once every request that
 * feeds it has resolved successfully with zero rows; while any of them is in
 * flight it is loading, and a failure is an error state — never an empty one.
 */
export function billingTableBodyState(input: {
  hasError: boolean;
  isLoading: boolean;
  rowCount: number;
}): BillingTableBodyState {
  if (input.isLoading) {
    return "loading";
  }
  if (input.hasError) {
    return "error";
  }
  return input.rowCount === 0 ? "empty" : "rows";
}

/**
 * The workspace list is scoped to the selected date range, so a workspace
 * scope can outlive its workspace when the range changes. Reconcile against
 * the freshly resolved list: an absent workspace falls back to the region
 * scope. Returns the input scope unchanged (same reference) when it is still
 * valid.
 */
export function reconcileCostScope(
  scope: BillingCostScope,
  workspaces: readonly BillingWorkspace[]
): BillingCostScope {
  if (scope.kind !== "workspace") {
    return scope;
  }
  return workspaces.some(([id]) => id === scope.workspace)
    ? scope
    : { kind: "region" };
}

/**
 * Same reconciliation for the app-type filter: a type absent from the new
 * range's catalog would keep filtering invisibly, so it falls back to "All"
 * (null). Returns the input filter unchanged when it is still listed.
 */
export function reconcileAppTypeFilter(
  appTypeFilter: string | null,
  appTypes: Record<string, string>
): string | null {
  if (appTypeFilter == null) {
    return null;
  }
  return Object.values(appTypes).includes(appTypeFilter) ? appTypeFilter : null;
}
