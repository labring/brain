import type { ProjectRuntimeFacts } from "@/features/project-canvas/runtime/resource-facts";
import type { SelectedContextReference } from "./persistence/types";

export type SelectedContextAvailability =
  | "available"
  | "unavailable"
  | "unknown";

export interface SelectedContextResourceIdentity {
  kind: SelectedContextReference["kind"];
  name: string;
  namespace: string;
  observedUid?: string;
}

export function selectedContextResourceIdentitiesFromFacts(
  facts: ProjectRuntimeFacts
): SelectedContextResourceIdentity[] {
  return [facts.apFacts, facts.dbFacts, facts.publicAccessFacts].flatMap(
    (resourceFacts) =>
      resourceFacts.map(({ ref, observedUid }) => ({
        kind: ref.kind,
        name: ref.name,
        namespace: ref.namespace,
        ...(observedUid === undefined ? {} : { observedUid }),
      }))
  );
}

/**
 * Resolve a message-scoped Context reference against an already-authenticated
 * Project resource snapshot. This function never reads the cluster itself.
 */
export function resolveSelectedContextAvailability(
  reference: SelectedContextReference,
  input: {
    ready: boolean;
    resources: readonly SelectedContextResourceIdentity[];
  }
): SelectedContextAvailability {
  if (!input.ready || reference.observedUid == null) {
    return "unknown";
  }

  const resource = input.resources.find(
    (candidate) =>
      candidate.kind === reference.kind &&
      candidate.name === reference.name &&
      candidate.namespace === reference.namespace
  );
  if (resource == null || resource.observedUid !== reference.observedUid) {
    return "unavailable";
  }
  return "available";
}
