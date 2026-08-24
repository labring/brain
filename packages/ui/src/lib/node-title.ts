/**
 * Node title on display surfaces (ADR 0062): the Resource Display Name when
 * one resolved, falling back to the Kubernetes name — one home for the
 * fallback rule shared by node headers, panes, and action surfaces.
 */
export function nodeTitle(states: {
  displayName?: string | undefined;
  name: string;
}): string;
export function nodeTitle(
  states:
    | { displayName?: string | undefined; name?: string | undefined }
    | null
    | undefined
): string | undefined;
export function nodeTitle(
  states:
    | { displayName?: string | undefined; name?: string | undefined }
    | null
    | undefined
): string | undefined {
  return states?.displayName ?? states?.name;
}
