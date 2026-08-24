import type { ProjectSurfaceTarget } from "@/features/panes/target-identity";
import { projectRuntimeResourceKey } from "@/features/project-canvas/runtime/resource-facts";

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
      ? projectRuntimeResourceKey({
          kind: "AP",
          name: target.apName,
          namespace: target.namespace,
        })
      : projectRuntimeResourceKey(target);
  return displayNamesByResourceKey.get(key);
}
