"use client";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";

/** RFC 6902 JSON Patch operation (Kubernetes `application/json-patch+json`). */
export type K8sJsonPatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown };

/**
 * Patches a namespaced resource via `PATCH /api/k8s/v1alpha1/patch?type=json`.
 * `kind` is the kubectl-style resource name (e.g. `aps`, `pods`).
 */
export async function k8sJsonPatchResource(
  kubeconfig: string,
  options: {
    kind: string;
    name: string;
    namespace: string;
    patch: K8sJsonPatchOp[];
  }
): Promise<void> {
  const kc = kubeconfig.trim();
  if (kc === "") {
    throw new Error("Kubeconfig is missing.");
  }
  const kind = options.kind.trim();
  const name = options.name.trim();
  const namespace = options.namespace.trim();
  if (kind === "" || name === "" || namespace === "") {
    throw new Error("kind, name, and namespace are required for patch.");
  }
  if (options.patch.length === 0) {
    throw new Error("Patch must include at least one operation.");
  }

  await fetcher({
    base: ApiUrl(),
    path: API_ROUTES.k8s.patch,
    method: "PATCH",
    query: {
      kind,
      name,
      namespace,
      type: "json",
    },
    header: {
      Authorization: `Bearer ${encodeURIComponent(kc)}`,
      "Content-Type": "application/json-patch+json",
    },
    body: options.patch,
  });
}
