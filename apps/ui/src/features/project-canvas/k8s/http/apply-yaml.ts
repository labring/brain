"use client";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";

/**
 * Applies multi-document YAML through the sealai k8s API (user kubeconfig in `Authorization`).
 */
export async function k8sApplyYaml(
  kubeconfig: string,
  yaml: string
): Promise<void> {
  await fetcher({
    base: ApiUrl(),
    path: API_ROUTES.k8s.apply,
    method: "POST",
    header: {
      Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
      "Content-Type": "application/json",
    },
    body: { yaml },
  });
}
