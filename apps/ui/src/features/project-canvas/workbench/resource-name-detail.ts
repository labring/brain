/**
 * Detail shown in parentheses beside a display name in destructive and
 * lifecycle confirmations (ADR 0062): the workload kind and, when it differs
 * from the display name, the Kubernetes name — so a renamed or duplicated
 * node cannot be mistaken.
 */
export function resourceNameDetail(target: {
  displayName: string;
  kind?: string;
  name: string;
}): string | undefined {
  const detail = [
    target.kind?.trim(),
    target.name === target.displayName ? undefined : target.name,
  ]
    .filter(Boolean)
    .join(" · ");
  return detail === "" ? undefined : detail;
}
