import "server-only";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import { probeManagedPublicUrl } from "./managed-public-probe";
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

async function fetchApProductView(input: {
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
          protocol: readiness.resolvedProtocol ?? card.resultRef.protocol,
          url: readiness.resolvedUrl,
        }
      : card.resultRef;
  return {
    ...card,
    latestStatusText: readiness.latestStatusText,
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

async function resultCardReadiness(input: {
  allowedDomain?: string;
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
    case "AccessEndpoint": {
      let publicUrl = resultRef.url;
      let readiness: DeploymentResultReadiness | null = null;
      if (resultRef.observer.kind === "ap-public-address") {
        const ap = await fetchApProductView({
          kubeconfig: input.kubeconfig,
          name: resultRef.observer.apName,
          namespace: resultRef.namespace,
          signal: input.signal,
        });
        const address = publicAddressViewFromAp({
          ap,
          publicAddressId: resultRef.observer.addressId,
        });
        readiness = publicAccessReadinessFromProductView(address);
        if (readiness.status !== "running") {
          return readiness;
        }
        publicUrl = stringValue(objectValue(address)?.url) ?? undefined;
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
      if (
        !(["http", "https", "ws", "wss"] as const).includes(resolvedProtocol)
      ) {
        throw new Error("The access endpoint protocol is unsupported.");
      }
      await probeManagedPublicUrl({
        allowedDomain: input.allowedDomain,
        deadlineAtMs: input.deadlineAtMs ?? Date.now() + 15_000,
        publicUrl,
        signal: input.signal,
      });
      return {
        eventMessage: `${resultRef.label} is reachable.`,
        latestStatusText: `${resultRef.label} is reachable.`,
        resolvedProtocol,
        resolvedUrl: publicUrl,
        status: "running",
      };
    }
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
