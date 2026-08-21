import type { ProjectSurfaceTarget } from "@/features/panes/target-identity";

/**
 * Module-level bridge from the canvas read model to surfaces mounted outside
 * the runtime store's React subtree (the chat composer pins the selection
 * snapshot at send time). The canvas publishes the Project's resolved
 * Resource Display Names keyed by Canvas Resource Identity; readers get a
 * display-only hint — never an identity (ADR 0062).
 */

const displayNamesByResourceKey = new Map<string, string>();

export function publishResourceDisplayNames(
  rows: readonly { displayName: string; key: string }[]
): void {
  displayNamesByResourceKey.clear();
  for (const row of rows) {
    displayNamesByResourceKey.set(row.key, row.displayName);
  }
}

export function resourceDisplayNameForTarget(
  target: ProjectSurfaceTarget
): string | undefined {
  // A Public Access node shows its AP's display name (ADR 0062).
  const key =
    target.kind === "PublicAccess"
      ? `AP:${target.namespace}:${target.apName}`
      : `${target.kind}:${target.namespace}:${target.name}`;
  return displayNamesByResourceKey.get(key);
}
