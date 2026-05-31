import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import {
  type K8sGetResponse,
  k8sGetQuerySchema,
  k8sGetResponseSchema,
} from "@workspace/api/schemas/k8s-get";
import { ApiUrl } from "@workspace/api/utils";

import { k8sGetClaimBody } from "./claim-mapper";

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/**
 * Fetches ConfigMap `{ name, namespace }` and returns embedded `data["config.yaml"]`
 * from the Kubernetes API proxy (`GET …/get?kind=configmaps`).
 */
export async function fetchConfigMapConfigYaml(options: {
  configMapName: string;
  kubeconfig: string;
  namespace: string;
  shareToken?: string;
}): Promise<string> {
  const kubeconfig = options.kubeconfig.trim();
  const name = options.configMapName.trim();
  const namespace = options.namespace.trim();
  const shareToken = options.shareToken?.trim() ?? "";

  const getParams = k8sGetQuerySchema.parse({
    kind: "configmaps",
    name,
    namespace,
  });

  const authHeader: Record<string, string> =
    shareToken === ""
      ? { Authorization: `Bearer ${encodeURIComponent(kubeconfig)}` }
      : { "X-Share-Token": shareToken };

  const raw = await fetcher<K8sGetResponse>({
    base: ApiUrl(),
    header: authHeader,
    method: "GET",
    path: API_ROUTES.k8s.get,
    query: {
      ...getParams,
      ...(shareToken === "" ? {} : { shareToken }),
    },
    select: (payload) => k8sGetResponseSchema.parse(payload),
  });

  const body = k8sGetClaimBody(raw);
  const dataField = body == null ? undefined : asRecord(body.data);
  if (dataField == null) {
    throw new Error("ConfigMap has no readable data payload.");
  }

  const yaml = dataField["config.yaml"];
  if (typeof yaml !== "string" || yaml.trim() === "") {
    throw new Error("ConfigMap is missing config.yaml.");
  }

  return yaml.trimEnd();
}
