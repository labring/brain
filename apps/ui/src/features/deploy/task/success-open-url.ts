import "server-only";

import {
  apNetworkViewFromProductView,
  apNetworkViewOpenUrl,
} from "./ap-network-view";
import {
  type DeploymentResultApCandidate,
  fetchApProductView,
} from "./result-readiness";

/**
 * The address the Success Record's Open control should open: the Default
 * Open Port rule applied to the first of the task's APs that has an openable
 * Public Address, read at the moment the record is written. Undefined leaves
 * the record's own order in charge — a task without an AP-like workload, or a
 * view that cannot be read, never blocks the conclusion over its Open button.
 */
export async function resolveDeploymentSuccessOpenUrl(input: {
  candidates: readonly DeploymentResultApCandidate[];
  kubeconfig: string;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  for (const candidate of input.candidates) {
    try {
      const url = apNetworkViewOpenUrl(
        apNetworkViewFromProductView(
          await fetchApProductView({
            kubeconfig: input.kubeconfig,
            name: candidate.name,
            namespace: candidate.namespace,
            signal: input.signal,
          })
        )
      );
      if (url !== undefined) {
        return url;
      }
    } catch (error) {
      if (input.signal?.aborted) {
        throw error;
      }
    }
  }
  return undefined;
}
