/**
 * Thin Brain-side public URL gate shared by deterministic and Agent-managed
 * deployments.
 *
 * Codex reports the deployed public URL; Brain fetches it directly from the
 * control plane (never from the Devbox). Any HTTP response proves that the
 * declared tenant route is reachable; application status and response content
 * deliberately remain outside this routing-health check.
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

async function probeWebSocketUrl(url: URL, timeoutMs: number): Promise<void> {
  if (typeof globalThis.WebSocket !== "function") {
    throw new Error("WebSocket endpoint verification is unavailable.");
  }
  await new Promise<void>((resolve, reject) => {
    const socket = new globalThis.WebSocket(url);
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error("WebSocket endpoint probe timed out."));
    }, timeoutMs);
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error == null) {
        resolve();
      } else {
        reject(error);
      }
    };
    socket.addEventListener("open", () => finish(), { once: true });
    socket.addEventListener(
      "error",
      () => finish(new Error("WebSocket endpoint upgrade failed.")),
      { once: true }
    );
  });
}

export async function probeManagedPublicUrl(input: {
  allowedDomain: string;
  deadlineAtMs: number;
  publicUrl: string;
}): Promise<void> {
  const url = new URL(input.publicUrl);
  if (!isAllowedDeploymentAccessUrl(url, input.allowedDomain)) {
    throw new Error("Public URL probe target is outside the tenant domain.");
  }
  const remainingMs = Math.max(1, input.deadlineAtMs - Date.now());
  if (url.protocol === "ws:" || url.protocol === "wss:") {
    await probeWebSocketUrl(url, Math.min(15_000, remainingMs));
    return;
  }
  await fetch(url, {
    // Do not follow a tenant response to an arbitrary external login or CDN.
    // The response itself is sufficient evidence that the tenant route exists.
    redirect: "manual",
    signal: AbortSignal.timeout(Math.min(15_000, remainingMs)),
  });
}
