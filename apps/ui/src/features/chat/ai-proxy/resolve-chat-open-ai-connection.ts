import "server-only";

import type { ChatOpenAiConnection } from "@/features/chat/runtime/model";

import { fetchOrCreateAiProxyToken } from "./create-token";
import { aiProxyOpenAiBaseUrl } from "./endpoints";
import { clusterHostnameFromKubeconfigText } from "./kubeconfig-hostname";

/** Default POST /tokens `{ name }` for user-billed AI proxy turns. Idempotent server-side when name exists in group. */
const DEFAULT_AI_PROXY_TOKEN_NAME = "sealos-brain";

export type ResolveChatOpenAiOutcome =
  | { ok: true; connection: ChatOpenAiConnection }
  | { ok: false; status: number; message: string };

/** Who pays for the model call: platform system token vs user AI proxy. */
export type ChatBillingMode = "free" | "user";

function trimmedEnv(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t && t.length > 0 ? t : undefined;
}

function resolveDevOpenAiConnection(): ResolveChatOpenAiOutcome | null {
  const devApiKey = trimmedEnv(process.env.DEV_OPENAI_API_KEY);
  const devBaseUrl = trimmedEnv(process.env.DEV_OPENAI_API_BASE_URL);
  if (devApiKey && devBaseUrl) {
    return {
      ok: true,
      connection: { apiKey: devApiKey, baseURL: devBaseUrl },
    };
  }
  return null;
}

function resolveSystemOpenAiConnection(): ResolveChatOpenAiOutcome {
  const apiKey = trimmedEnv(process.env.SYSTEM_OPENAI_API_KEY);
  const baseURL = trimmedEnv(process.env.SYSTEM_OPENAI_API_BASE_URL);
  if (apiKey && baseURL) {
    return { ok: true, connection: { apiKey, baseURL } };
  }
  return {
    ok: false,
    status: 503,
    message:
      "Free assistant turns require SYSTEM_OPENAI_API_KEY and SYSTEM_OPENAI_API_BASE_URL.",
  };
}

/**
 * Resolves `{ apiKey, baseURL }` for OpenAI-compatible chat:
 * - `DEV_OPENAI_*` → local development override.
 * - `billing: "free"` → `SYSTEM_OPENAI_*` (platform token).
 * - `billing: "user"` → AI proxy token from kubeconfig.
 */
export async function resolveChatOpenAiConnection(options: {
  encodedKubeconfig: string | undefined;
  kubeconfigText: string;
  billing: ChatBillingMode;
}): Promise<ResolveChatOpenAiOutcome> {
  const dev = resolveDevOpenAiConnection();
  if (dev != null) {
    return dev;
  }

  if (options.billing === "free") {
    return resolveSystemOpenAiConnection();
  }

  const authorization = options.encodedKubeconfig?.trim();
  if (!authorization) {
    return {
      ok: false,
      status: 400,
      message: "Missing kubeconfig credential for AI proxy.",
    };
  }

  const hostname = clusterHostnameFromKubeconfigText(options.kubeconfigText);
  if (!hostname) {
    return {
      ok: false,
      status: 400,
      message:
        "Could not read Kubernetes API server hostname from kubeconfig for AI proxy.",
    };
  }

  const rawName =
    trimmedEnv(process.env.AI_PROXY_TOKEN_NAME) ?? DEFAULT_AI_PROXY_TOKEN_NAME;
  const tokenName = rawName.length > 100 ? rawName.slice(0, 100) : rawName;

  const tokenResult = await fetchOrCreateAiProxyToken({
    clusterHostname: hostname,
    authorizationEncodedKubeconfig: authorization,
    name: tokenName,
  });

  if (!tokenResult.ok) {
    const detail =
      tokenResult.bodyText.length > 0 && tokenResult.bodyText.length < 400
        ? tokenResult.bodyText
        : "AI proxy rejected the token request.";
    const fallbackStatus =
      tokenResult.status >= 400 && tokenResult.status < 600
        ? tokenResult.status
        : 502;
    return {
      ok: false,
      status: fallbackStatus,
      message: detail,
    };
  }

  return {
    ok: true,
    connection: {
      apiKey: tokenResult.token.key,
      baseURL: aiProxyOpenAiBaseUrl(hostname),
    },
  };
}
