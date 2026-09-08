/**
 * The Default Open Port rule (CONTEXT.md): which App Listening Port the Open
 * control opens, and through which of its Public Addresses. One pure function
 * serves both the AP Public Access Node (canvas mapping) and the AP Network
 * Settings header, so the two never disagree.
 *
 * - A stored Default Open Port (`status.network.defaultOpenPort`) wins when it
 *   has an HTTP Public Address; a stale one is ignored, never surfaced.
 * - Otherwise the first App Listening Port, in declaration order, that has an
 *   HTTP Public Address at the root (`/`); with none at the root, the first
 *   that has any HTTP Public Address. Ports reached only over WS/WSS are
 *   never chosen. Backend ports routed under `/api` and the like therefore
 *   yield to the page port however the template ordered them.
 * - URL: an accessible Custom Domain of that port, else an accessible
 *   Platform Address; with neither the target has no URL and Open is drawn
 *   disabled with `disabledReason`.
 */

export interface ApOpenTargetPort {
  displayName?: string;
  port: number;
}

export type ApOpenTargetAddressKind = "custom" | "platform";

export interface ApOpenTargetAddress {
  accessible: boolean;
  kind: ApOpenTargetAddressKind;
  port: number;
  /** Full URL; absent while the address is pending (still counts as HTTP). */
  url?: string;
}

export interface ApOpenTarget {
  disabledReason?: string;
  /** "Open <Port Display Name>", or "Open" for an unnamed port. */
  label: string;
  port: number;
  url?: string;
}

export interface ApOpenTargetInput {
  addresses: readonly ApOpenTargetAddress[];
  /** The stored choice as the API surfaced it; absent means automatic. */
  defaultOpenPort?: number;
  /** App Listening Ports in declaration order. */
  ports: readonly ApOpenTargetPort[];
}

export const AP_OPEN_TARGET_LABEL = "Open";
export const AP_OPEN_TARGET_NOT_ACCESSIBLE_REASON = "Not accessible yet";

const WEBSOCKET_URL_PATTERN = /^wss?:\/\//i;

/** WS/WSS Public Addresses are copy-only; everything else is a browser URL. */
export function isHttpOpenTargetAddress(
  address: Pick<ApOpenTargetAddress, "url">
): boolean {
  const url = address.url?.trim() ?? "";
  return url === "" || !WEBSOCKET_URL_PATTERN.test(url);
}

export function apOpenTargetLabel(displayName: string | undefined): string {
  const name = displayName?.trim() ?? "";
  return name === "" ? AP_OPEN_TARGET_LABEL : `${AP_OPEN_TARGET_LABEL} ${name}`;
}

function roundedPort(port: number): number {
  return Math.round(port);
}

/** A pending address (no URL yet) is Brain-created and will route at the root. */
function isRootOpenTargetAddress(
  address: Pick<ApOpenTargetAddress, "url">
): boolean {
  const url = address.url?.trim() ?? "";
  if (url === "") {
    return true;
  }
  try {
    return new URL(url).pathname === "/";
  } catch {
    return false;
  }
}

/**
 * Ports that can be the Default Open Port, in preference order: every App
 * Listening Port with an HTTP Public Address at the root, in declaration
 * order, then every remaining port with any HTTP Public Address, in
 * declaration order. With no declared ports (legacy read models) the
 * addresses' own ports stand in, ascending.
 */
export function apOpenTargetEligiblePorts({
  addresses,
  ports,
}: Pick<ApOpenTargetInput, "addresses" | "ports">): number[] {
  const httpAddresses = addresses.filter((address) =>
    isHttpOpenTargetAddress(address)
  );
  const httpPorts = new Set(
    httpAddresses.map((address) => roundedPort(address.port))
  );
  const rootPorts = new Set(
    httpAddresses
      .filter((address) => isRootOpenTargetAddress(address))
      .map((address) => roundedPort(address.port))
  );
  const candidates =
    ports.length > 0
      ? ports.map((port) => roundedPort(port.port))
      : Array.from(httpPorts).sort((a, b) => a - b);
  const seen = new Set<number>();
  const declared = candidates.filter((port) => {
    if (seen.has(port) || !httpPorts.has(port)) {
      return false;
    }
    seen.add(port);
    return true;
  });
  return [
    ...declared.filter((port) => rootPorts.has(port)),
    ...declared.filter((port) => !rootPorts.has(port)),
  ];
}

function bestUrlForPort(
  addresses: readonly ApOpenTargetAddress[],
  port: number
): string | undefined {
  const candidates = addresses.filter(
    (address) =>
      roundedPort(address.port) === port &&
      address.accessible &&
      isHttpOpenTargetAddress(address) &&
      address.url !== undefined &&
      address.url.trim() !== ""
  );
  const custom = candidates.find((address) => address.kind === "custom");
  return (custom ?? candidates[0])?.url?.trim();
}

export function resolveApOpenTarget({
  addresses,
  defaultOpenPort,
  ports,
}: ApOpenTargetInput): ApOpenTarget | undefined {
  const eligible = apOpenTargetEligiblePorts({ addresses, ports });
  if (eligible.length === 0) {
    return undefined;
  }
  const stored =
    defaultOpenPort === undefined ? undefined : roundedPort(defaultOpenPort);
  const port =
    stored !== undefined && eligible.includes(stored) ? stored : eligible[0];
  if (port === undefined) {
    return undefined;
  }
  const url = bestUrlForPort(addresses, port);
  const displayName = ports.find(
    (candidate) => roundedPort(candidate.port) === port
  )?.displayName;
  return {
    ...(url === undefined
      ? { disabledReason: AP_OPEN_TARGET_NOT_ACCESSIBLE_REASON }
      : { url }),
    label: apOpenTargetLabel(displayName),
    port,
  };
}
