import YAML from "yaml";

import type { DeploymentResultReadiness } from "./readiness";
import type { DeployTaskArtifactSummary } from "./schema";
import {
  type DeploymentResultResourceCard,
  type DeploymentResultResourceRef,
  deploymentResultResourceCardId,
} from "./timeline";

const TEMPLATE_WORKLOAD_KIND_BY_NORMALIZED = new Map([
  ["cronjob", "CronJob"],
  ["daemonset", "DaemonSet"],
  ["deployment", "Deployment"],
  ["statefulset", "StatefulSet"],
]);

function templateWorkloadKind(kind: string): string | null {
  return TEMPLATE_WORKLOAD_KIND_BY_NORMALIZED.get(kind.toLowerCase()) ?? null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resultCard(
  ref: DeploymentResultResourceRef,
  input: { required?: boolean } = {}
): DeploymentResultResourceCard {
  const title = ref.kind === "PublicAccess" ? "Public access" : ref.name;
  return {
    events: [],
    id: deploymentResultResourceCardId(ref),
    required: input.required ?? true,
    resultRef: ref,
    status: "creating",
    title,
  };
}

function directApDocsFromResourceYamls(
  summary: DeployTaskArtifactSummary
): Record<string, unknown>[] {
  return (summary.resourceYamls ?? []).flatMap((raw) => {
    try {
      return YAML.parseAllDocuments(raw).flatMap((doc) => {
        const parsed = objectValue(doc.toJS());
        return parsed?.apiVersion === "brain.io/direct" && parsed.kind === "AP"
          ? [parsed]
          : [];
      });
    } catch {
      return [];
    }
  });
}

function publicAddressId(input: {
  address: Record<string, unknown>;
  index: number;
  kind: "custom" | "platform";
}): string {
  return (
    stringValue(input.address.id) ??
    stringValue(input.address.host) ??
    stringValue(input.address.domain) ??
    `${input.kind}-${input.index + 1}`
  );
}

function publicAccessCardsFromApDoc(
  doc: Record<string, unknown>
): DeploymentResultResourceCard[] {
  const metadata = objectValue(doc.metadata);
  const apName = stringValue(metadata?.name);
  const namespace = stringValue(metadata?.namespace);
  if (apName == null || namespace == null) {
    return [];
  }

  const network = objectValue(
    objectValue(objectValue(doc.spec)?.input)?.network
  );
  const platformAddresses = Array.isArray(network?.platformAddresses)
    ? network.platformAddresses
    : [];
  const customAddresses = Array.isArray(network?.publicAddresses)
    ? network.publicAddresses
    : [];

  return [
    ...platformAddresses.map((address, index) => ({
      address,
      index,
      kind: "platform" as const,
    })),
    ...customAddresses.map((address, index) => ({
      address,
      index,
      kind: "custom" as const,
    })),
  ].flatMap((entry) => {
    const address = objectValue(entry.address);
    if (address == null) {
      return [];
    }
    return [
      resultCard(
        {
          apName,
          id: publicAddressId({
            address,
            index: entry.index,
            kind: entry.kind,
          }),
          kind: "PublicAccess",
          namespace,
        },
        { required: address.required === true }
      ),
    ];
  });
}

function publicAccessCardsFromArtifactSummary(
  summary: DeployTaskArtifactSummary
): DeploymentResultResourceCard[] {
  return directApDocsFromResourceYamls(summary).flatMap(
    publicAccessCardsFromApDoc
  );
}

export function apResultResourceCardsFromArtifactSummary(
  summary: DeployTaskArtifactSummary
): DeploymentResultResourceCard[] {
  return resultResourceCardsFromArtifactSummary(summary).filter(
    (card) => card.resultRef.kind === "AP"
  );
}

export function resultResourceCardsFromArtifactSummary(
  summary: DeployTaskArtifactSummary
): DeploymentResultResourceCard[] {
  return [
    ...(summary.resources ?? []).flatMap((resource) => {
      if (resource.apiVersion === "brain.io/direct") {
        if (resource.kind !== "AP" && resource.kind !== "DB") {
          return [];
        }
        return [
          resultCard({
            kind: resource.kind,
            name: resource.name,
            namespace: resource.namespace,
          }),
        ];
      }

      const workloadKind = templateWorkloadKind(resource.kind);
      if (workloadKind == null) {
        return [];
      }
      return [
        resultCard({
          kind: "TemplateWorkload",
          name: resource.name,
          namespace: resource.namespace,
          workloadKind,
        }),
      ];
    }),
    ...publicAccessCardsFromArtifactSummary(summary),
  ];
}

export function applyApReadinessToResultCard(
  card: DeploymentResultResourceCard,
  readiness: DeploymentResultReadiness
): DeploymentResultResourceCard {
  return {
    ...card,
    latestStatusText: readiness.latestStatusText,
    status: readiness.status,
  };
}
