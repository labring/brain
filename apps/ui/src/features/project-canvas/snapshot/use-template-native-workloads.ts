"use client";

import {
  type K8sNamespacedListRefreshInterval,
  useK8sNamespacedList,
} from "@workspace/api/hooks";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";

export function useTemplateNativeWorkloads(options: {
  kubeconfig: string;
  labelSelector: string;
  namespace: string;
  refreshInterval?: K8sNamespacedListRefreshInterval;
}): {
  data: {
    deployments: K8sGetResponse | undefined;
    statefulSets: K8sGetResponse | undefined;
  };
  error: Error | undefined;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const deployments = useK8sNamespacedList({
    kind: "deployments",
    kubeconfig: options.kubeconfig,
    labelSelector: options.labelSelector,
    namespace: options.namespace,
    refreshInterval: options.refreshInterval,
  });
  const statefulSets = useK8sNamespacedList({
    kind: "statefulsets",
    kubeconfig: options.kubeconfig,
    labelSelector: options.labelSelector,
    namespace: options.namespace,
    refreshInterval: options.refreshInterval,
  });

  return {
    data: {
      deployments: deployments.data,
      statefulSets: statefulSets.data,
    },
    error: deployments.error ?? statefulSets.error,
    isLoading: deployments.isLoading || statefulSets.isLoading,
    mutate: () => Promise.all([deployments.mutate(), statefulSets.mutate()]),
  };
}
