import "server-only";

import type { ChatOpenAiConnection } from "@/features/chat/runtime/model";
import { resolveUserAiProxyCredentials } from "@/lib/ai-proxy/resolve-user-ai-proxy-credentials";

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

  const userCredentials = await resolveUserAiProxyCredentials({
    encodedKubeconfig: options.encodedKubeconfig,
    kubeconfigText: options.kubeconfigText,
  });
  if (!userCredentials.ok) {
    if (userCredentials.reason === "missing-kubeconfig") {
      return {
        ok: false,
        status: userCredentials.status,
        message: "Missing kubeconfig credential for AI proxy.",
      };
    }
    if (userCredentials.reason === "invalid-kubeconfig") {
      return {
        ok: false,
        status: userCredentials.status,
        message:
          "Could not read Kubernetes API server hostname from kubeconfig for AI proxy.",
      };
    }
    const upstreamBodyText = userCredentials.upstreamBodyText ?? "";
    const detail =
      upstreamBodyText.length > 0 && upstreamBodyText.length < 400
        ? upstreamBodyText
        : "AI proxy rejected the token request.";
    return {
      ok: false,
      status: userCredentials.status,
      message: detail,
    };
  }

  return {
    ok: true,
    connection: {
      apiKey: userCredentials.credentials.apiKey,
      baseURL: userCredentials.credentials.baseUrl,
    },
  };
}
