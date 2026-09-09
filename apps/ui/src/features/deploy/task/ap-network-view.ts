import {
  type ApOpenTargetAddress,
  type ApOpenTargetPort,
  resolveApOpenTarget,
} from "@/features/resource-settings/ap/ap-open-target";

/**
 * The slice of the AP Product View (`status.network`) that a Deployment Task
 * needs when it names and orders verified Access Endpoints (CONTEXT.md: Port
 * Display Name, Default Open Port). Every value here is read as the API
 * resolved it — the display name and the stored Default Open Port are never
 * re-derived on this side (ADR 0080).
 */

export interface ApNetworkViewAddress {
  accessible: boolean;
  host?: string;
  id?: string;
  kind: "custom" | "observed" | "platform";
  port: number;
  url?: string;
}

export interface ApNetworkView {
  addresses: ApNetworkViewAddress[];
  defaultOpenPort?: number;
  /** App Listening Ports in declaration order. */
  ports: ApOpenTargetPort[];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function portValue(value: unknown): number | undefined {
  let port = Number.NaN;
  if (typeof value === "number") {
    port = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    port = Number(value);
  }
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? port
    : undefined;
}

function addressKind(value: unknown): ApNetworkViewAddress["kind"] {
  const type = stringValue(value)?.toLowerCase();
  return type === "custom" || type === "observed" ? type : "platform";
}

function hostname(value: string | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const row = objectValue(item);
        return row == null ? [] : [row];
      })
    : [];
}

/** `status.network.appListeningPorts[]`, first occurrence of a port wins. */
function appListeningPortsFromNetwork(
  network: Record<string, unknown> | null
): ApOpenTargetPort[] {
  const ports: ApOpenTargetPort[] = [];
  const seen = new Set<number>();
  for (const row of rows(network?.appListeningPorts)) {
    const port = portValue(row.port);
    if (port === undefined || seen.has(port)) {
      continue;
    }
    seen.add(port);
    const displayName = stringValue(row.displayName);
    ports.push({ ...(displayName === undefined ? {} : { displayName }), port });
  }
  return ports;
}

/** `status.network.publicAddresses[]`; a row without a target port is skipped. */
function publicAddressesFromNetwork(
  network: Record<string, unknown> | null
): ApNetworkViewAddress[] {
  const addresses: ApNetworkViewAddress[] = [];
  for (const row of rows(network?.publicAddresses)) {
    const port = portValue(row.port);
    if (port === undefined) {
      continue;
    }
    const url = stringValue(row.url);
    const host = stringValue(row.host)?.toLowerCase() ?? hostname(url);
    const id = stringValue(row.id);
    addresses.push({
      accessible: stringValue(row.status)?.toLowerCase() === "accessible",
      ...(host === undefined ? {} : { host }),
      ...(id === undefined ? {} : { id }),
      kind: addressKind(row.type),
      port,
      ...(url === undefined ? {} : { url }),
    });
  }
  return addresses;
}

/** `status.network` of one AP Product View, tolerant of an unknown shape. */
export function apNetworkViewFromProductView(ap: unknown): ApNetworkView {
  const network = objectValue(objectValue(objectValue(ap)?.status)?.network);
  const ports = appListeningPortsFromNetwork(network);
  const addresses = publicAddressesFromNetwork(network);
  const defaultOpenPort = portValue(network?.defaultOpenPort);
  return {
    addresses,
    ...(defaultOpenPort === undefined ? {} : { defaultOpenPort }),
    ports,
  };
}

/**
 * How an App Listening Port is written wherever a Public Address is shown:
 * `game · 5200` with a Port Display Name, `5200` alone without one — the same
 * heading the AP Public Access Node and AP Network Settings use.
 */
export function appListeningPortLabel(port: ApOpenTargetPort): string {
  const name = port.displayName?.trim() ?? "";
  const number = String(Math.round(port.port));
  return name === "" ? number : `${name} · ${number}`;
}

/** The label a Public Address of `port` carries; the port itself when unnamed. */
export function accessEndpointLabelForPort(
  view: ApNetworkView,
  port: number | undefined
): string | undefined {
  if (port === undefined) {
    return undefined;
  }
  const declared = view.ports.find((candidate) => candidate.port === port);
  return appListeningPortLabel(declared ?? { port });
}

/** The address row observed for `host`, when the AP knows that host at all. */
export function apNetworkViewAddressForHost(
  view: ApNetworkView,
  host: string
): ApNetworkViewAddress | undefined {
  const wanted = host.trim().toLowerCase();
  return wanted === ""
    ? undefined
    : view.addresses.find((address) => address.host === wanted);
}

const TRAILING_SLASHES_RE = /\/+$/;

interface ParsedEndpointUrl {
  host: string;
  path: string;
  scheme: string;
}

function parseEndpointUrl(raw: string | undefined): ParsedEndpointUrl | null {
  const value = raw?.trim() ?? "";
  if (value === "") {
    return null;
  }
  try {
    const url = new URL(value);
    const path = url.pathname.replace(TRAILING_SLASHES_RE, "");
    return {
      host: url.hostname.toLowerCase(),
      path: path === "" ? "/" : path,
      scheme: url.protocol.slice(0, -1).toLowerCase(),
    };
  } catch {
    return null;
  }
}

/**
 * The address row an endpoint URL reaches. One hostname may expose several
 * Public Addresses that differ by protocol or path and target different
 * App Listening Ports (ADR 0079: a `wss://` game port beside an `https://`
 * admin path), so the URL is matched whole — scheme, host, and entry path —
 * and nothing looser: an entry is headed by the port its address reaches,
 * else by nothing (CONTEXT.md: Deployment Task Success Record), so a
 * same-host row for another port must never stand in.
 */
export function apNetworkViewAddressForUrl(
  view: ApNetworkView,
  url: string
): ApNetworkViewAddress | undefined {
  const wanted = parseEndpointUrl(url);
  if (wanted === null) {
    return undefined;
  }
  return view.addresses.find((address) => {
    const parsed = parseEndpointUrl(address.url);
    return (
      address.host === wanted.host &&
      parsed?.scheme === wanted.scheme &&
      parsed.path === wanted.path
    );
  });
}

/**
 * The URL the Open control would open for this AP right now: the Default
 * Open Port rule over the same view the Public Access Node reads. Observed
 * addresses stand in as Platform Addresses — they are never Custom Domains,
 * and the rule only uses the kind to prefer a Custom Domain.
 */
export function apNetworkViewOpenUrl(view: ApNetworkView): string | undefined {
  const addresses = view.addresses.map(
    (address): ApOpenTargetAddress => ({
      accessible: address.accessible,
      kind: address.kind === "custom" ? "custom" : "platform",
      port: address.port,
      ...(address.url === undefined ? {} : { url: address.url }),
    })
  );
  return resolveApOpenTarget({
    addresses,
    ...(view.defaultOpenPort === undefined
      ? {}
      : { defaultOpenPort: view.defaultOpenPort }),
    ports: view.ports,
  })?.url;
}
