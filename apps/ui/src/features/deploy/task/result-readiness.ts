import "server-only";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import {
  type ApNetworkView,
  accessEndpointLabelForPort,
  apNetworkViewAddressForUrl,
  apNetworkViewFromProductView,
} from "./ap-network-view";
import {
  AccessEndpointHttpError,
  probeManagedPublicUrl,
} from "./managed-public-probe";
import {
  apWorkloadReadinessFromProductView,
  type DeploymentResultReadiness,
  dbServiceReadinessFromProductView,
  publicAccessReadinessFromProductView,
  templateWorkloadReadinessFromProductView,
} from "./readiness";
import type {
  DeploymentAccessEndpointProtocol,
  DeploymentResultResourceCard,
  DeploymentResultResourceRef,
} from "./timeline";

interface DeploymentResultObservation extends DeploymentResultReadiness {
  resolvedLabel?: string;
  resolvedProtocol?: DeploymentAccessEndpointProtocol;
  resolvedUrl?: string;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function fetchApProductView(input: {
  kubeconfig: string;
  name: string;
  namespace: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  return await fetcher({
    base: ApiUrl(),
    header: {
      Authorization: `Bearer ${encodeURIComponent(input.kubeconfig)}`,
    },
    method: "GET",
    path: API_ROUTES.ap.root,
    query: {
      name: input.name,
      namespace: input.namespace,
    },
    signal: input.signal,
  });
}

async function fetchDbProductView(input: {
  kubeconfig: string;
  name: string;
  namespace: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  return await fetcher({
    base: ApiUrl(),
    header: {
      Authorization: `Bearer ${encodeURIComponent(input.kubeconfig)}`,
    },
    method: "GET",
    path: API_ROUTES.db.root,
    query: {
      name: input.name,
      namespace: input.namespace,
    },
    signal: input.signal,
  });
}

function templateWorkloadK8sKind(kind: string): string {
  switch (kind) {
    case "CronJob":
      return "cronjobs";
    case "DaemonSet":
      return "daemonsets";
    case "Deployment":
      return "deployments";
    case "StatefulSet":
      return "statefulsets";
    default:
      return kind.toLowerCase();
  }
}

async function fetchTemplateWorkloadProductView(input: {
  kubeconfig: string;
  name: string;
  namespace: string;
  signal?: AbortSignal;
  workloadKind: string;
}): Promise<unknown> {
  return await fetcher({
    base: ApiUrl(),
    header: {
      Authorization: `Bearer ${encodeURIComponent(input.kubeconfig)}`,
    },
    method: "GET",
    path: API_ROUTES.k8s.get,
    query: {
      kind: templateWorkloadK8sKind(input.workloadKind),
      name: input.name,
      namespace: input.namespace,
    },
    signal: input.signal,
  });
}

function publicAddressViewFromAp(input: {
  ap: unknown;
  publicAddressId: string;
}): unknown {
  const status = objectValue(objectValue(input.ap)?.status);
  const network = objectValue(status?.network);
  const publicAddresses = Array.isArray(network?.publicAddresses)
    ? network.publicAddresses
    : [];
  return (
    publicAddresses.find((address) => {
      const record = objectValue(address);
      return (
        stringValue(record?.id) === input.publicAddressId ||
        stringValue(record?.host) === input.publicAddressId
      );
    }) ?? { status: "unknown" }
  );
}

export function readinessEventSeverity(
  status: DeploymentResultReadiness["status"]
): "info" | "success" | "warning" | "error" {
  if (status === "running") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "blocked") {
    return "warning";
  }
  return "info";
}

function applyReadinessToResultCard(
  card: DeploymentResultResourceCard,
  readiness: DeploymentResultObservation
): DeploymentResultResourceCard {
  const resultRef: DeploymentResultResourceRef =
    card.resultRef.kind === "AccessEndpoint" && readiness.resolvedUrl != null
      ? {
          ...card.resultRef,
          label: readiness.resolvedLabel ?? card.resultRef.label,
          protocol: readiness.resolvedProtocol ?? card.resultRef.protocol,
          url: readiness.resolvedUrl,
        }
      : card.resultRef;
  return {
    ...card,
    latestStatusText: readiness.latestStatusText,
    title: readiness.resolvedLabel ?? card.title,
    resultRef,
    status: readiness.status,
  };
}

export function resultReadinessForPresentation(
  card: DeploymentResultResourceCard,
  readiness: DeploymentResultReadiness,
  options: { surfaceObservationError?: boolean } = {}
): DeploymentResultReadiness {
  if (options.surfaceObservationError !== false) {
    return readiness;
  }
  const label = resultReadinessLabel(card);
  let statusText: string;
  switch (readiness.status) {
    case "running":
      statusText = `${label} is running.`;
      break;
    case "failed":
      statusText = `${label} failed readiness.`;
      break;
    case "blocked":
      statusText = `${label} readiness is blocked.`;
      break;
    case "pending":
    case "creating":
      statusText = `Waiting for ${label} readiness.`;
      break;
    case "unknown":
      statusText = `Waiting for ${label} observation.`;
      break;
    default:
      readiness.status satisfies never;
      statusText = `Waiting for ${label} observation.`;
      break;
  }
  return {
    ...readiness,
    eventMessage: statusText,
    latestStatusText: statusText,
    status: readiness.status,
  };
}

export function resultReadinessEventReason(
  card: DeploymentResultResourceCard
): string {
  switch (card.resultRef.kind) {
    case "AP":
      return "APWorkloadReadiness";
    case "DB":
      return "DBServiceReadiness";
    case "PublicAccess":
      return "PublicAddressReadiness";
    case "AccessEndpoint":
      return "AccessEndpointReadiness";
    case "TemplatePublicAccess":
      return "TemplatePublicAccessReadiness";
    case "KubernetesWorkload":
      return "KubernetesWorkloadReadiness";
    case "TemplateWorkload":
      return "TemplateWorkloadReadiness";
    default:
      return card.resultRef satisfies never;
  }
}

export function resultReadinessLabel(
  card: DeploymentResultResourceCard
): string {
  switch (card.resultRef.kind) {
    case "AP":
      return `AP ${card.resultRef.name}`;
    case "DB":
      return `DB Service ${card.resultRef.name}`;
    case "PublicAccess":
      return `Public Address ${card.resultRef.id}`;
    case "AccessEndpoint":
      return `${card.resultRef.label} ${card.resultRef.url ?? card.resultRef.id}`;
    case "TemplatePublicAccess":
      return `Public domain ${card.resultRef.url}`;
    case "KubernetesWorkload":
      return `${card.resultRef.workloadKind} ${card.resultRef.name}`;
    case "TemplateWorkload":
      return `${card.resultRef.workloadKind} ${card.resultRef.name}`;
    default:
      return card.resultRef satisfies never;
  }
}

export function isResultReadinessTerminalError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("failed readiness") ||
      error.message.includes("readiness is blocked"))
  );
}

export function waitingForResultObservationStatus(
  card: DeploymentResultResourceCard,
  error: unknown,
  options: { surfaceObservationError?: boolean } = {}
): string {
  return options.surfaceObservationError !== false && error instanceof Error
    ? `Waiting for ${resultReadinessLabel(card)} observation: ${error.message}`
    : `Waiting for ${resultReadinessLabel(card)} observation.`;
}

function canDiscoverIngressRoot(
  ref: DeploymentResultResourceRef,
  url: URL,
  error: unknown
): boolean {
  return (
    ref.kind === "AccessEndpoint" &&
    ref.observer.kind === "ingress" &&
    error instanceof AccessEndpointHttpError &&
    error.status === 404 &&
    url.pathname !== "/"
  );
}

async function probeAccessEndpoint(
  ref: Extract<DeploymentResultResourceRef, { kind: "AccessEndpoint" }>,
  publicUrl: string,
  options: Omit<Parameters<typeof probeManagedPublicUrl>[0], "publicUrl">
): Promise<{ url: string; label: string }> {
  try {
    await probeManagedPublicUrl({ ...options, publicUrl });
    return { url: publicUrl, label: ref.label };
  } catch (error) {
    // Ingress paths are routing candidates, not declared health checks.
    // Keep the same deadline and tenant boundary when discovering the root.
    const parsed = new URL(publicUrl);
    if (!canDiscoverIngressRoot(ref, parsed, error)) {
      throw error;
    }
    const rootUrl = new URL("/", parsed).href;
    await probeManagedPublicUrl({ ...options, publicUrl: rootUrl });
    return { url: rootUrl, label: "Web address" };
  }
}

/** An AP the task created, whose Product View may know an Ingress host. */
export interface DeploymentResultApCandidate {
  name: string;
  namespace: string;
}

/**
 * The task's own workloads that the AP Product View can describe: direct APs,
 * and template workloads the API lists as AP-like. Card order is kept, so the
 * first workload the task declared is asked first.
 */
export function deploymentResultApCandidates(
  cards: readonly DeploymentResultResourceCard[]
): DeploymentResultApCandidate[] {
  const candidates: DeploymentResultApCandidate[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const ref = card.resultRef;
    if (
      ref.kind !== "AP" &&
      !(
        ref.kind === "TemplateWorkload" &&
        (ref.workloadKind === "Deployment" ||
          ref.workloadKind === "StatefulSet")
      )
    ) {
      continue;
    }
    const key = `${ref.namespace}/${ref.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push({ name: ref.name, namespace: ref.namespace });
  }
  return candidates;
}

/**
 * The label an Ingress-observed endpoint carries once verified — and the one
 * a template's Open Entry is headed by in the Success Record: the Port
 * Display Name form of the App Listening Port behind that URL, read from
 * the first candidate AP whose Product View observed its host. The URL is
 * matched whole, since one host may expose several ports by protocol and
 * path. A host no AP claims — a template with no AP-like workload, or a view
 * that cannot be read — yields nothing; naming is never invented here.
 */
export async function accessEndpointPortLabelForUrl(input: {
  candidates: readonly DeploymentResultApCandidate[];
  kubeconfig: string;
  signal?: AbortSignal;
  url: string;
}): Promise<string | undefined> {
  for (const candidate of input.candidates) {
    let view: ApNetworkView;
    try {
      view = apNetworkViewFromProductView(
        await fetchApProductView({
          kubeconfig: input.kubeconfig,
          name: candidate.name,
          namespace: candidate.namespace,
          signal: input.signal,
        })
      );
    } catch (error) {
      if (input.signal?.aborted) {
        throw error;
      }
      continue;
    }
    const address = apNetworkViewAddressForUrl(view, input.url);
    if (address != null) {
      return accessEndpointLabelForPort(view, address.port);
    }
  }
  return undefined;
}

/**
 * The AP Public Address behind an endpoint, as its Product View reports it:
 * the readiness to surface while it is not yet accessible, else the assigned
 * URL and the App Listening Port label the verified entry will carry.
 */
async function apPublicAddressObservation(input: {
  addressId: string;
  apName: string;
  kubeconfig: string;
  namespace: string;
  signal?: AbortSignal;
}): Promise<
  | { pending: DeploymentResultReadiness }
  | { portLabel: string | undefined; publicUrl: string | undefined }
> {
  const ap = await fetchApProductView({
    kubeconfig: input.kubeconfig,
    name: input.apName,
    namespace: input.namespace,
    signal: input.signal,
  });
  const address = publicAddressViewFromAp({
    ap,
    publicAddressId: input.addressId,
  });
  const readiness = publicAccessReadinessFromProductView(address);
  if (readiness.status !== "running") {
    return { pending: readiness };
  }
  const view = apNetworkViewFromProductView(ap);
  const addressPort = view.addresses.find(
    (candidate) =>
      candidate.id === input.addressId || candidate.host === input.addressId
  )?.port;
  return {
    portLabel: accessEndpointLabelForPort(view, addressPort),
    publicUrl: stringValue(objectValue(address)?.url) ?? undefined,
  };
}

async function accessEndpointReadiness(
  input: {
    allowedDomain?: string;
    apCandidates?: readonly DeploymentResultApCandidate[];
    deadlineAtMs?: number;
    kubeconfig: string;
    signal?: AbortSignal;
  },
  resultRef: Extract<DeploymentResultResourceRef, { kind: "AccessEndpoint" }>
): Promise<DeploymentResultObservation> {
  let publicUrl = resultRef.url;
  // The verified entry is named after the App Listening Port it reaches
  // (Port Display Name, or the port number alone), captured here at
  // verification time so the Success Record keeps what the user saw.
  let portLabel: string | undefined;
  if (resultRef.observer.kind === "ap-public-address") {
    const observation = await apPublicAddressObservation({
      addressId: resultRef.observer.addressId,
      apName: resultRef.observer.apName,
      kubeconfig: input.kubeconfig,
      namespace: resultRef.namespace,
      signal: input.signal,
    });
    if ("pending" in observation) {
      return observation.pending;
    }
    publicUrl = observation.publicUrl;
    portLabel = observation.portLabel;
  }
  if (publicUrl == null) {
    throw new Error("The access endpoint URL has not been assigned yet.");
  }
  if (!input.allowedDomain) {
    throw new Error("Tenant routing domain is unavailable.");
  }
  const parsed = new URL(publicUrl);
  const resolvedProtocol = parsed.protocol.slice(
    0,
    -1
  ) as DeploymentAccessEndpointProtocol;
  if (!(["http", "https", "ws", "wss"] as const).includes(resolvedProtocol)) {
    throw new Error("The access endpoint protocol is unsupported.");
  }
  const resolved = await probeAccessEndpoint(resultRef, publicUrl, {
    allowedDomain: input.allowedDomain,
    deadlineAtMs: input.deadlineAtMs ?? Date.now() + 15_000,
    signal: input.signal,
  });
  publicUrl = resolved.url;
  if (
    portLabel === undefined &&
    resultRef.observer.kind === "ingress" &&
    input.apCandidates != null &&
    input.apCandidates.length > 0
  ) {
    portLabel = await accessEndpointPortLabelForUrl({
      candidates: input.apCandidates,
      kubeconfig: input.kubeconfig,
      signal: input.signal,
      url: publicUrl,
    });
  }
  const resolvedLabel = portLabel ?? resolved.label;
  return {
    eventMessage: `${resolvedLabel} is reachable.`,
    latestStatusText: `${resolvedLabel} is reachable.`,
    resolvedLabel,
    resolvedProtocol,
    resolvedUrl: publicUrl,
    status: "running",
  };
}

async function resultCardReadiness(input: {
  allowedDomain?: string;
  apCandidates?: readonly DeploymentResultApCandidate[];
  card: DeploymentResultResourceCard;
  deadlineAtMs?: number;
  kubeconfig: string;
  signal?: AbortSignal;
}): Promise<DeploymentResultObservation> {
  const { resultRef } = input.card;
  switch (resultRef.kind) {
    case "AP": {
      const ap = await fetchApProductView({
        kubeconfig: input.kubeconfig,
        name: resultRef.name,
        namespace: resultRef.namespace,
        signal: input.signal,
      });
      return apWorkloadReadinessFromProductView(ap);
    }
    case "DB": {
      const db = await fetchDbProductView({
        kubeconfig: input.kubeconfig,
        name: resultRef.name,
        namespace: resultRef.namespace,
        signal: input.signal,
      });
      return dbServiceReadinessFromProductView(db);
    }
    case "PublicAccess": {
      const ap = await fetchApProductView({
        kubeconfig: input.kubeconfig,
        name: resultRef.apName,
        namespace: resultRef.namespace,
        signal: input.signal,
      });
      return publicAccessReadinessFromProductView(
        publicAddressViewFromAp({
          ap,
          publicAddressId: resultRef.id,
        })
      );
    }
    case "AccessEndpoint":
      return await accessEndpointReadiness(input, resultRef);
    case "TemplatePublicAccess": {
      if (!input.allowedDomain) {
        throw new Error("Tenant routing domain is unavailable.");
      }
      await probeManagedPublicUrl({
        allowedDomain: input.allowedDomain,
        deadlineAtMs: input.deadlineAtMs ?? Date.now() + 15_000,
        publicUrl: resultRef.url,
        signal: input.signal,
      });
      return {
        eventMessage: "Public domain is reachable.",
        latestStatusText: "Public domain is reachable.",
        status: "running",
      };
    }
    case "KubernetesWorkload":
      throw new Error(
        "Kubernetes workload readiness is supplied by the managed deployment runner."
      );
    case "TemplateWorkload": {
      const workload = await fetchTemplateWorkloadProductView({
        kubeconfig: input.kubeconfig,
        name: resultRef.name,
        namespace: resultRef.namespace,
        signal: input.signal,
        workloadKind: resultRef.workloadKind,
      });
      return templateWorkloadReadinessFromProductView(
        workload,
        resultRef.workloadKind
      );
    }
    default:
      return resultRef satisfies never;
  }
}

export async function observeDeploymentResultCardReadiness(input: {
  allowedDomain?: string;
  /** APs of the same task, consulted to name an Ingress-observed endpoint. */
  apCandidates?: readonly DeploymentResultApCandidate[];
  card: DeploymentResultResourceCard;
  deadlineAtMs?: number;
  kubeconfig: string;
  signal?: AbortSignal;
  surfaceObservationError?: boolean;
}): Promise<{
  card: DeploymentResultResourceCard;
  eventMessage: string;
  eventReason: string;
  eventSeverity: "info" | "success" | "warning" | "error";
  latestStatus: string;
  observed: boolean;
  running: boolean;
  status: DeploymentResultResourceCard["status"];
}> {
  try {
    const observedReadiness = await resultCardReadiness(input);
    const readiness = resultReadinessForPresentation(
      input.card,
      observedReadiness,
      { surfaceObservationError: input.surfaceObservationError }
    );
    const nextCard = applyReadinessToResultCard(input.card, readiness);
    return {
      card: nextCard,
      eventMessage: readiness.eventMessage,
      eventReason: resultReadinessEventReason(input.card),
      eventSeverity: readinessEventSeverity(readiness.status),
      latestStatus: readiness.latestStatusText,
      observed: true,
      running: !input.card.required || readiness.status === "running",
      status: readiness.status,
    };
  } catch (error) {
    if (input.signal?.aborted) {
      throw input.signal.reason instanceof Error ? input.signal.reason : error;
    }
    const latestStatus = waitingForResultObservationStatus(input.card, error, {
      surfaceObservationError: input.surfaceObservationError,
    });
    return {
      card: {
        ...input.card,
        latestStatusText: latestStatus,
        status: "unknown",
      },
      eventMessage: latestStatus,
      eventReason: resultReadinessEventReason(input.card),
      eventSeverity: "info",
      latestStatus,
      observed: false,
      running: !input.card.required,
      status: "unknown",
    };
  }
}
