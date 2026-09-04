/**
 * Thin Brain-side public URL gate shared by deterministic and Agent-managed
 * deployments.
 *
 * Codex reports the deployed public URL; Brain fetches it directly from the
 * control plane (never from the Devbox). HTTP must finish with a successful
 * application response, and WebSocket must complete the protocol upgrade.
 */

export function isAllowedDeploymentAccessUrl(
  url: URL,
  allowedDomain: string
): boolean {
  return (
    ["http:", "https:", "ws:", "wss:"].includes(url.protocol) &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "" &&
    (url.hostname === allowedDomain ||
      url.hostname.endsWith(`.${allowedDomain}`))
  );
}

/** Historical name retained for callers that specifically validate HTTP. */
export function isAllowedManagedHttpUrl(
  url: URL,
  allowedDomain: string
): boolean {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    isAllowedDeploymentAccessUrl(url, allowedDomain)
  );
}

function accessProbeSignal(input: {
  deadlineAtMs: number;
  signal?: AbortSignal;
}): AbortSignal {
  const timeout = AbortSignal.timeout(
    Math.min(15_000, Math.max(1, input.deadlineAtMs - Date.now()))
  );
  return input.signal == null
    ? timeout
    : AbortSignal.any([input.signal, timeout]);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Access endpoint probe was aborted.");
}

async function probeWebSocketUrl(url: URL, signal: AbortSignal): Promise<void> {
  if (typeof globalThis.WebSocket !== "function") {
    throw new Error("WebSocket endpoint verification is unavailable.");
  }
  if (signal.aborted) {
    throw abortError(signal);
  }
  await new Promise<void>((resolve, reject) => {
    const socket = new globalThis.WebSocket(url);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      socket.close();
      if (error == null) {
        resolve();
      } else {
        reject(error);
      }
    };
    const onAbort = () => finish(abortError(signal));
    socket.addEventListener("open", () => finish(), { once: true });
    socket.addEventListener(
      "error",
      () => finish(new Error("WebSocket endpoint upgrade failed.")),
      { once: true }
    );
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function probeManagedPublicUrl(input: {
  allowedDomain: string;
  deadlineAtMs: number;
  publicUrl: string;
  signal?: AbortSignal;
}): Promise<void> {
  let url = new URL(input.publicUrl);
  const signal = accessProbeSignal(input);
  if (url.protocol === "ws:" || url.protocol === "wss:") {
    if (!isAllowedDeploymentAccessUrl(url, input.allowedDomain)) {
      throw new Error("Public URL probe target is outside the tenant domain.");
    }
    await probeWebSocketUrl(url, signal);
    return;
  }
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (!isAllowedDeploymentAccessUrl(url, input.allowedDomain)) {
      throw new Error("Public URL probe target is outside the tenant domain.");
    }
    const response = await fetch(url, { redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location == null || redirects === 5) {
        throw new Error("Access endpoint probe exceeded its redirect limit.");
      }
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Access endpoint probe returned ${response.status}.`);
    }
    return;
  }
}
