import "server-only";

import { tool } from "ai";
import { z } from "zod";

import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/features/chat/tool/chat-tool-intention";

const TRAILING_SLASHES = /\/+$/;

const FETCH_TIMEOUT_MS = 30_000;

export function buildApiOpenApiDocsUrl(): string | null {
  const raw = process.env.API_URL?.trim();
  if (raw === undefined || raw === "") {
    return null;
  }
  const base = raw.replace(TRAILING_SLASHES, "");
  return `${base}/docs`;
}

async function probeDocsEndpoint(
  docsUrl: string,
  signal: AbortSignal
): Promise<Response> {
  const common = {
    redirect: "follow",
    signal,
    headers: { accept: "*/*" },
  } as const;

  let response = await fetch(docsUrl, { method: "HEAD", ...common });
  if (response.status !== 405 && response.status !== 501) {
    return response;
  }
  response = await fetch(docsUrl, { method: "GET", ...common });
  return response;
}

const readApiOpenApiDocsInputSchema = z.object({
  intention: chatToolIntentionField,
});

export const readApiOpenApiDocsTool = tool({
  description: [
    "Confirm the Seal API interactive docs URL (Scalar at `/docs` on `API_URL`) is reachable.",
    "Does **not** return page HTML—full OpenAPI content would overload the model. For endpoint lists, tags, and operation details, use **`sliceOpenApiDocs`** with `openapiDocsBase` set to the same docs URL (or API root); it loads `openapi.json` and returns structured slices.",
    "The Seal HTTP API fits work that is awkward in the sandbox CLI/FS (e.g. metrics, logs for a resource).",
    "Include `intention`: why you are probing `/docs` vs going straight to `sliceOpenApiDocs`.",
  ].join(" "),
  inputSchema: readApiOpenApiDocsInputSchema,
  execute: async ({ intention }) => {
    logChatToolIntention("readApiOpenApiDocs", intention);
    const docsUrl = buildApiOpenApiDocsUrl();
    if (docsUrl == null) {
      return {
        ok: false as const,
        error: "API_URL is not set; cannot derive OpenAPI docs URL.",
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await probeDocsEndpoint(docsUrl, controller.signal);
      const contentType = response.headers.get("content-type") ?? "";

      if (response.body != null) {
        await response.body.cancel();
      }

      return {
        ok: response.ok,
        url: docsUrl,
        status: response.status,
        contentType,
        nextStep:
          "Use tool `sliceOpenApiDocs` with `openapiDocsBase` e.g. this `url` (optionally `#tag/…` or `endpointOpenApiPath`)—not this tool—for OpenAPI content.",
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown fetch error";
      return {
        ok: false as const,
        url: docsUrl,
        error: message,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  },
});
