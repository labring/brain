import { z } from "zod";

import { aiProxyTokensUrl } from "./endpoints";

/**
 * Successful POST `/api/v2alpha/tokens` body: only `key` is strictly validated.
 * Upstream mixes `subnet` vs `subnets`, omits `expired_at` on newer builds, adds `period_*`, etc.
 */
const tokenCreatedResponseSchema = z
  .object({
    key: z.string().min(1),
  })
  .passthrough();

export type AiProxyCreatedToken = z.infer<typeof tokenCreatedResponseSchema>;

export async function fetchOrCreateAiProxyToken(options: {
  clusterHostname: string;
  authorizationEncodedKubeconfig: string;
  name: string;
}): Promise<
  | { ok: true; token: AiProxyCreatedToken }
  | { ok: false; status: number; bodyText: string }
> {
  const url = aiProxyTokensUrl(options.clusterHostname);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: options.authorizationEncodedKubeconfig,
    },
    body: JSON.stringify({ name: options.name }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, bodyText };
  }

  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return { ok: false, status: response.status || 502, bodyText };
  }

  const parsed = tokenCreatedResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status: response.status || 502, bodyText };
  }

  return { ok: true, token: parsed.data };
}
