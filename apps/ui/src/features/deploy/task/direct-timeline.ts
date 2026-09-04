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
  const title = resultCardTitle(ref);
  return {
    events: [],
    id: deploymentResultResourceCardId(ref),
    required: input.required ?? true,
    resultRef: ref,
    status: "creating",
    title,
  };
}

function resultCardTitle(ref: DeploymentResultResourceRef): string {
  switch (ref.kind) {
    case "AccessEndpoint":
      return ref.label;
    case "PublicAccess":
      return "Public access";
    case "TemplatePublicAccess":
      return "Public domain";
    case "KubernetesWorkload":
      return ref.name;
    default:
      return ref.name;
  }
}

const DNS_HOST_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const INGRESS_PATH_RESERVED_CHARACTER_RE = /[?#]/;

function ingressHost(value: unknown): string | null {
  const host = stringValue(value)?.toLowerCase();
  return host != null && DNS_HOST_RE.test(host) ? host : null;
}

function yamlResourceDocs(raw: string): Record<string, unknown>[] {
  try {
    return YAML.parseAllDocuments(raw).flatMap((doc) => {
      const parsed = objectValue(doc.toJS());
      return parsed == null ? [] : [parsed];
    });
  } catch {
    return [];
  }
}

function ingressTlsHosts(spec: Record<string, unknown> | null): Set<string> {
  return new Set(
    (Array.isArray(spec?.tls) ? spec.tls : []).flatMap((entry) => {
      const tls = objectValue(entry);
      return (Array.isArray(tls?.hosts) ? tls.hosts : []).flatMap((host) => {
        const normalized = ingressHost(host);
        return normalized == null ? [] : [normalized];
      });
    })
  );
}

const LEGACY_WEBSOCKET_BACKEND_PROTOCOL =
  "nginx.ingress.kubernetes.io/backend-protocol";

function ingressCarriesLegacyWebSocketMarker(
  doc: Record<string, unknown>
): boolean {
  const annotations = objectValue(objectValue(doc.metadata)?.annotations);
  const backendProtocol = stringValue(
    annotations?.[LEGACY_WEBSOCKET_BACKEND_PROTOCOL]
  )?.toUpperCase();
  // Existing provider templates use these non-standard values as a public
  // WebSocket marker. Keep that narrow compatibility signal without treating
  // every Ingress path as a separate product entry point.
  return backendProtocol === "WS" || backendProtocol === "WSS";
}

function ingressPaths(rule: Record<string, unknown>): string[] {
  const http = objectValue(rule.http);
  const paths = Array.isArray(http?.paths) ? http.paths : [];
  return [
    ...new Set(
      paths.flatMap((entry) => {
        const path = stringValue(objectValue(entry)?.path);
        return path?.startsWith("/") &&
          !INGRESS_PATH_RESERVED_CHARACTER_RE.test(path)
          ? [path]
          : [];
      })
    ),
  ];
}

function ingressAccessEndpointCard(input: {
  host: string;
  identity: { name: string; namespace: string };
  path: string;
  protocol: "http" | "https" | "ws" | "wss";
}): DeploymentResultResourceCard {
  const baseLabel =
    input.protocol === "ws" || input.protocol === "wss"
      ? "WebSocket address"
      : "Web address";
  const label = input.path === "/" ? baseLabel : `${baseLabel} ${input.path}`;
  const url = `${input.protocol}://${input.host}${input.path}`;
  return resultCard({
    id: `ingress:${input.identity.name}:${input.protocol}:${input.host}:${input.path}`,
    kind: "AccessEndpoint",
    label,
    namespace: input.identity.namespace,
    observer: { kind: "ingress", name: input.identity.name },
    protocol: input.protocol,
    url,
  });
}

function templateIngressIdentity(
  summary: DeployTaskArtifactSummary,
  doc: Record<string, unknown>,
  fallbackNamespace?: string
): { name: string; namespace: string } | null {
  const apiVersion = stringValue(doc.apiVersion);
  if (
    apiVersion == null ||
    !apiVersion.startsWith("networking.k8s.io/") ||
    doc.kind !== "Ingress"
  ) {
    return null;
  }
  const metadata = objectValue(doc.metadata);
  const name = stringValue(metadata?.name);
  const namespace =
    stringValue(metadata?.namespace) ??
    stringValue(fallbackNamespace) ??
    summary.resources?.find(
      (resource) =>
        resource.apiVersion === apiVersion &&
        resource.kind === "Ingress" &&
        resource.name === name
    )?.namespace ??
    null;
  return name == null || namespace == null ? null : { name, namespace };
}

function templatePublicAccessCardsFromDoc(
  summary: DeployTaskArtifactSummary,
  doc: Record<string, unknown>,
  fallbackNamespace?: string
): DeploymentResultResourceCard[] {
  const identity = templateIngressIdentity(summary, doc, fallbackNamespace);
  if (identity == null) {
    return [];
  }
  const spec = objectValue(doc.spec);
  const tlsHosts = ingressTlsHosts(spec);
  const declaresWebSocket = ingressCarriesLegacyWebSocketMarker(doc);
  return (Array.isArray(spec?.rules) ? spec.rules : []).flatMap((ruleValue) => {
    const rule = objectValue(ruleValue);
    const host = ingressHost(rule?.host);
    if (host == null || rule == null) {
      return [];
    }
    const webProtocol = tlsHosts.has(host) ? "https" : "http";
    const websocketProtocol = tlsHosts.has(host) ? "wss" : "ws";
    return ingressPaths(rule).flatMap((path) => [
      ingressAccessEndpointCard({
        host,
        identity,
        path,
        protocol: webProtocol,
      }),
      ...(declaresWebSocket
        ? [
            ingressAccessEndpointCard({
              host,
              identity,
              path,
              protocol: websocketProtocol,
            }),
          ]
        : []),
    ]);
  });
}

function selectPrimaryTemplatePublicAccessCards(
  cards: DeploymentResultResourceCard[]
): DeploymentResultResourceCard[] {
  const cardsByRoleAndHost = new Map<
    string,
    { card: DeploymentResultResourceCard; rootPath: boolean }
  >();
  for (const card of cards) {
    if (
      card.resultRef.kind !== "AccessEndpoint" ||
      card.resultRef.observer.kind !== "ingress" ||
      card.resultRef.url == null
    ) {
      continue;
    }
    const url = new URL(card.resultRef.url);
    const role =
      card.resultRef.protocol === "ws" || card.resultRef.protocol === "wss"
        ? "websocket"
        : "web";
    const key = `${role}:${url.hostname}`;
    const rootPath = url.pathname === "/";
    const selected = cardsByRoleAndHost.get(key);
    // Ingress paths describe routing implementation, not a list of product
    // entry points. Keep one primary address per host and protocol role. A
    // declared root is the stable default; path-only apps retain their first
    // manifest-ordered path without probing every fallback route.
    if (selected == null || (rootPath && !selected.rootPath)) {
      cardsByRoleAndHost.set(key, { card, rootPath });
    }
  }
  return [...cardsByRoleAndHost.values()].map(({ card }) => card);
}

export function templatePublicAccessCardsFromObservedIngresses(input: {
  ingresses: unknown[];
  namespace: string;
}): DeploymentResultResourceCard[] {
  return selectPrimaryTemplatePublicAccessCards(
    input.ingresses.flatMap((ingress) => {
      const doc = objectValue(ingress);
      return doc == null
        ? []
        : templatePublicAccessCardsFromDoc({}, doc, input.namespace);
    })
  );
}

function templatePublicAccessCardsFromArtifactSummary(
  summary: DeployTaskArtifactSummary
): DeploymentResultResourceCard[] {
  const cards = (summary.resourceYamls ?? []).flatMap((raw) =>
    yamlResourceDocs(raw).flatMap((doc) =>
      templatePublicAccessCardsFromDoc(summary, doc)
    )
  );
  return selectPrimaryTemplatePublicAccessCards(cards);
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
    const addressId = publicAddressId({
      address,
      index: entry.index,
      kind: entry.kind,
    });
    return [
      resultCard(
        {
          id: `public-address:${addressId}`,
          kind: "AccessEndpoint",
          label: "Public address",
          namespace,
          observer: {
            apName,
            addressId,
            kind: "ap-public-address",
          },
          protocol: "https",
        },
        { required: address.required !== false }
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
    ...templatePublicAccessCardsFromArtifactSummary(summary),
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
