/**
 * Thin Brain-side public URL gate for Agent-managed deployments.
 *
 * Codex reports the deployed public URL; Brain fetches it directly from the
 * control plane (never from the Devbox) and requires 2xx with a non-empty
 * body. The target must stay inside the tenant-owned routing domain so a
 * confused or adversarial Agent cannot point Brain at arbitrary hosts.
 */

export function isAllowedManagedHttpUrl(
  url: URL,
  allowedDomain: string
): boolean {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    (url.hostname === allowedDomain ||
      url.hostname.endsWith(`.${allowedDomain}`))
  );
}

async function assertManagedHttpResponseBody(
  response: Response
): Promise<void> {
  const reader = response.body?.getReader();
  if (reader == null) {
    throw new Error("Public URL probe returned an empty body.");
  }
  const first = await reader.read();
  await reader.cancel().catch(() => undefined);
  if (first.done || first.value.byteLength === 0) {
    throw new Error("Public URL probe returned an empty body.");
  }
}

export async function probeManagedPublicUrl(input: {
  allowedDomain: string;
  deadlineAtMs: number;
  publicUrl: string;
}): Promise<void> {
  let url = new URL(input.publicUrl);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (!isAllowedManagedHttpUrl(url, input.allowedDomain)) {
      throw new Error("Public URL probe target is outside the tenant domain.");
    }
    const remainingMs = Math.max(1, input.deadlineAtMs - Date.now());
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(Math.min(15_000, remainingMs)),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location == null || redirects === 5) {
        throw new Error("Public URL probe exceeded its redirect limit.");
      }
      url = new URL(location, url);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Public URL probe returned ${response.status}.`);
    }
    await assertManagedHttpResponseBody(response);
    return;
  }
}
