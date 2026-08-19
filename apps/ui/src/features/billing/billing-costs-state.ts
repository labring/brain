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
