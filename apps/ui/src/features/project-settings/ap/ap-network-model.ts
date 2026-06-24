"use client";

export interface ApNetworkPublicAddress {
  domainPrefix?: string;
  host?: string;
  id?: string;
  platformAddressId?: string;
  port: number;
  reason?: string;
  status?: string;
  type?: string;
  url?: string;
}

export interface ApNetworkPublicAddressDraft extends ApNetworkPublicAddress {
  id: string;
  port: number;
}

export interface ApNetworkCustomDomainDetail {
  message?: string;
  reason?: string;
  status?: string;
  target?: string;
  verifiedAt?: string;
}

export interface ApNetworkCustomDomain {
  certificate?: ApNetworkCustomDomainDetail;
  cnameTarget?: string;
  dns?: ApNetworkCustomDomainDetail;
  domain: string;
  id: string;
  platformAddressId: string;
  reason?: string;
  routing?: ApNetworkCustomDomainDetail;
  status?: string;
  targetPort?: number;
}

export interface ApNetworkAppListeningPort {
  port: number;
  privateAddress?: string;
}

export interface ApNetwork {
  appListeningPorts?: ApNetworkAppListeningPort[];
  customDomains?: ApNetworkCustomDomain[];
  privateAddress?: string;
  privatePort: number;
  publicAddresses: ApNetworkPublicAddress[];
}

export interface ApNetworkPlatformAddressDraftContext {
  appName?: string;
  namespace?: string;
  routingDomain?: string;
}

export interface ApCustomDomainCnameVerificationResult {
  message?: string;
  ok: boolean;
  reason?: string;
}

export type ApCustomDomainCnameVerifier = (input: {
  domain: string;
  target: string;
}) => Promise<ApCustomDomainCnameVerificationResult>;

function publicAddressDraftsEqual(
  a: readonly ApNetworkPublicAddress[],
  b: readonly ApNetworkPublicAddress[]
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((address, index) => {
    const other = b[index];
    return (
      other != null &&
      publicAddressIdValue(address) === publicAddressIdValue(other) &&
      Math.round(address.port) === Math.round(other.port)
    );
  });
}

function customDomainDraftsEqual(
  a: readonly ApNetworkCustomDomain[] | undefined,
  b: readonly ApNetworkCustomDomain[] | undefined
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  return left.every((domain, index) => {
    const other = right[index];
    return (
      other != null &&
      domain.id.trim() === other.id.trim() &&
      domain.domain.trim().toLowerCase() ===
        other.domain.trim().toLowerCase() &&
      domain.platformAddressId.trim() === other.platformAddressId.trim() &&
      (domain.cnameTarget?.trim() ?? "") ===
        (other.cnameTarget?.trim() ?? "") &&
      Math.round(domain.targetPort ?? 0) === Math.round(other.targetPort ?? 0)
    );
  });
}

export function apNetworksEqual(
  a: ApNetwork | undefined,
  b: ApNetwork | undefined
): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return (
    Math.round(a.privatePort) === Math.round(b.privatePort) &&
    appListeningPortDraftsEqual(
      appListeningPortsFromNetwork(a),
      appListeningPortsFromNetwork(b)
    ) &&
    publicAddressDraftsEqual(a.publicAddresses, b.publicAddresses) &&
    customDomainDraftsEqual(a.customDomains, b.customDomains)
  );
}

function validApNetworkPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export function appListeningPortsFromNetwork(
  network: Pick<
    ApNetwork,
    "appListeningPorts" | "privateAddress" | "privatePort"
  >
): ApNetworkAppListeningPort[] {
  const rows = network.appListeningPorts ?? [];
  const normalized = rows.flatMap((row) =>
    validApNetworkPort(Math.round(row.port))
      ? [
          {
            ...(row.privateAddress == null || row.privateAddress.trim() === ""
              ? {}
              : { privateAddress: row.privateAddress }),
            port: Math.round(row.port),
          },
        ]
      : []
  );
  if (normalized.length > 0) {
    return normalized;
  }
  return [
    {
      ...(network.privateAddress == null || network.privateAddress.trim() === ""
        ? {}
        : { privateAddress: network.privateAddress }),
      port: Math.round(network.privatePort),
    },
  ];
}

export function networkWithAppListeningPorts(
  network: ApNetwork,
  appListeningPorts: readonly ApNetworkAppListeningPort[]
): ApNetwork {
  const normalized =
    appListeningPorts.length === 0
      ? appListeningPortsFromNetwork(network).slice(0, 1)
      : appListeningPorts.map((row) => ({
          ...(row.privateAddress == null || row.privateAddress.trim() === ""
            ? {}
            : { privateAddress: row.privateAddress }),
          port: Math.round(row.port),
        }));
  const first = normalized[0];
  return {
    ...network,
    ...(first?.privateAddress == null
      ? {}
      : { privateAddress: first.privateAddress }),
    appListeningPorts: [...normalized],
    privatePort: first?.port ?? network.privatePort,
  };
}

export function networkWithAppListeningPort(
  network: ApNetwork,
  port: number
): ApNetwork {
  const rounded = Math.round(port);
  const ports = appListeningPortsFromNetwork(network);
  if (ports.some((row) => Math.round(row.port) === rounded)) {
    return networkWithAppListeningPorts(network, ports);
  }
  return networkWithAppListeningPorts(network, [...ports, { port: rounded }]);
}

export function networkWithoutAppListeningPort(
  network: ApNetwork,
  port: number
): ApNetwork {
  const rounded = Math.round(port);
  const next = appListeningPortsFromNetwork(network).filter(
    (row) => Math.round(row.port) !== rounded
  );
  return networkWithAppListeningPorts(network, next);
}

export function addedAppListeningPorts(
  previous: ApNetwork,
  next: ApNetwork
): number[] {
  const previousPorts = new Set(
    appListeningPortsFromNetwork(previous).map((row) => Math.round(row.port))
  );
  return appListeningPortsFromNetwork(next)
    .map((row) => Math.round(row.port))
    .filter((port) => !previousPorts.has(port));
}

function appListeningPortDraftsEqual(
  a: readonly ApNetworkAppListeningPort[] | undefined,
  b: readonly ApNetworkAppListeningPort[] | undefined
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  return left.every((row, index) => {
    const other = right[index];
    return other != null && Math.round(row.port) === Math.round(other.port);
  });
}

export function publicAddressDefaultPort(network: ApNetwork): number {
  return appListeningPortsFromNetwork(network)[0]?.port ?? 80;
}

export function publicAddressesTargetingPort(
  network: ApNetwork,
  port: number
): ApNetworkPublicAddress[] {
  const rounded = Math.round(port);
  return network.publicAddresses.filter(
    (address) => Math.round(address.port) === rounded
  );
}

export function publicAddressValue(address: ApNetworkPublicAddress): string {
  return address.url?.trim() || address.host?.trim() || "";
}

export function publicAddressDisplayName(address: ApNetworkPublicAddress) {
  return (
    publicAddressValue(address) ||
    address.host?.trim() ||
    address.id?.trim() ||
    `Port ${address.port}`
  );
}

export function publicAddressIdValue(address: ApNetworkPublicAddress): string {
  return address.id?.trim() || address.platformAddressId?.trim() || "";
}

export interface ApNetworkPublicAddressTarget {
  address: ApNetworkPublicAddress;
  publicAddressIndex: number;
}

export type ApNetworkVisiblePublicAddressRow = ApNetworkPublicAddressTarget;

export interface ApNetworkVisibleDomainRows {
  customDomains: ApNetworkCustomDomain[];
  publicAddressRows: ApNetworkVisiblePublicAddressRow[];
}

export function visibleDomainRows(
  network: ApNetwork
): ApNetworkVisibleDomainRows {
  const customDomains = network.customDomains ?? [];
  const boundPlatformAddressIds = new Set(
    customDomains
      .map((domain) => domain.platformAddressId.trim())
      .filter((id) => id !== "")
  );
  return {
    customDomains,
    publicAddressRows: network.publicAddresses.flatMap((address, index) => {
      const addressId = publicAddressIdValue(address);
      return addressId !== "" && boundPlatformAddressIds.has(addressId)
        ? []
        : [{ address, publicAddressIndex: index }];
    }),
  };
}

export function isPublicAddressMutationTarget(
  address: ApNetworkPublicAddress,
  index: number,
  target: ApNetworkPublicAddressTarget
): boolean {
  const targetId = publicAddressIdValue(target.address);
  if (targetId !== "") {
    return publicAddressIdValue(address) === targetId;
  }
  return address === target.address || index === target.publicAddressIndex;
}

export function isPublicAddressDeleteTarget(
  address: ApNetworkPublicAddress,
  index: number,
  target: ApNetworkPublicAddressTarget
): boolean {
  const targetId = publicAddressIdValue(target.address);
  if (targetId !== "") {
    return publicAddressIdValue(address) === targetId;
  }
  return address === target.address || index === target.publicAddressIndex;
}

export function apNetworkAfterUnbindCustomDomain(
  network: ApNetwork,
  target: Pick<ApNetworkCustomDomain, "id">
): ApNetwork {
  const targetId = target.id.trim();
  return {
    ...network,
    customDomains: (network.customDomains ?? []).filter(
      (domain) => domain.id.trim() !== targetId
    ),
  };
}

export function apNetworkAfterEditPublicAddress(
  network: ApNetwork,
  draft: {
    customDomain?: ApNetworkCustomDomain;
    publicAddress: ApNetworkPublicAddressTarget;
    port: number;
  }
): ApNetwork {
  const next = {
    ...network,
    customDomains:
      draft.customDomain == null
        ? network.customDomains
        : [
            ...(network.customDomains ?? []),
            { ...draft.customDomain, targetPort: draft.port },
          ],
    publicAddresses: network.publicAddresses.map((address, index) =>
      isPublicAddressMutationTarget(address, index, draft.publicAddress)
        ? { ...address, port: draft.port }
        : address
    ),
  };
  return networkWithAppListeningPort(next, draft.port);
}

export function apNetworkAfterBindCustomDomain(
  network: ApNetwork,
  draft: {
    customDomain: ApNetworkCustomDomain;
    publicAddress: ApNetworkPublicAddressTarget;
    port: number;
  }
): ApNetwork {
  return apNetworkAfterEditPublicAddress(network, draft);
}

export function apNetworkAfterDeletePublicAddress(
  network: ApNetwork,
  target: ApNetworkPublicAddressTarget
): ApNetwork {
  return {
    ...network,
    publicAddresses: network.publicAddresses.filter(
      (address, itemIndex) =>
        !isPublicAddressDeleteTarget(address, itemIndex, target)
    ),
  };
}

export function apNetworkWithAddedPublicAddress(
  network: ApNetwork,
  draft: {
    customDomain?: ApNetworkCustomDomain;
    publicAddress: ApNetworkPublicAddressDraft;
  }
): ApNetwork {
  const next = {
    ...network,
    customDomains:
      draft.customDomain == null
        ? network.customDomains
        : [...(network.customDomains ?? []), draft.customDomain],
    publicAddresses: [...network.publicAddresses, draft.publicAddress],
  };
  return networkWithAppListeningPort(next, draft.publicAddress.port);
}
