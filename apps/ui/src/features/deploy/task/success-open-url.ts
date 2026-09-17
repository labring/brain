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
 *
 * `urls` is every Public Address that view currently lists, so the Success
 * Record can show the same set the canvas Public Access node shows.
 */
export async function resolveDeploymentSuccessPublicView(input: {
  candidates: readonly DeploymentResultApCandidate[];
  kubeconfig: string;
  signal?: AbortSignal;
}): Promise<{ openUrl?: string; urls: string[] }> {
  const urls: string[] = [];
  const seen = new Set<string>();
  let openUrl: string | undefined;
  for (const candidate of input.candidates) {
    try {
      const view = apNetworkViewFromProductView(
        await fetchApProductView({
          kubeconfig: input.kubeconfig,
          name: candidate.name,
          namespace: candidate.namespace,
          signal: input.signal,
        })
      );
      for (const address of view.addresses) {
        const url = address.url?.trim() ?? "";
        if (url === "" || seen.has(url)) {
          continue;
        }
        seen.add(url);
        urls.push(url);
      }
      openUrl ??= apNetworkViewOpenUrl(view);
    } catch (error) {
      if (input.signal?.aborted) {
        throw error;
      }
    }
  }
  return { urls, ...(openUrl === undefined ? {} : { openUrl }) };
}

export async function resolveDeploymentSuccessOpenUrl(input: {
  candidates: readonly DeploymentResultApCandidate[];
  kubeconfig: string;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  return (await resolveDeploymentSuccessPublicView(input)).openUrl;
}
