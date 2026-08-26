import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import { resourceDisplayNameMergePatch } from "./resource-display-name";

/**
 * Persist one Resource Display Name change through the product PATCH route.
 * Only the annotation is patched; `metadata.name` stays untouched — the
 * Kubernetes name is immutable (ADR 0066).
 */
export async function applyResourceDisplayName(input: {
  kind: "AP" | "DB";
  kubeconfig: string;
  name: string;
  namespace: string;
  value: string;
}): Promise<void> {
  await fetcher({
    base: ApiUrl(),
    body: resourceDisplayNameMergePatch(input.value),
    header: {
      Authorization: `Bearer ${encodeURIComponent(input.kubeconfig.trim())}`,
    },
    method: "PATCH",
    path: input.kind === "DB" ? API_ROUTES.db.root : API_ROUTES.ap.root,
    query: { name: input.name, namespace: input.namespace },
  });
}
