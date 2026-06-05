import { API_ROUTES } from "@workspace/api/constants";
import { type FetcherOptions, fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import { tool } from "ai";
import YAML from "yaml";
import { z } from "zod";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/lib/tool/chat-tool-intention";

export type BrainProductToolResourceKind = "AP" | "DB" | "EntryPoint";

export type BrainProductToolWriteOperation = "create" | "delete" | "patch";

export interface ProductResourceRequestInput {
  base?: string;
  body?: unknown;
  kind: BrainProductToolResourceKind;
  kubeconfig: string;
  labelSelector?: string;
  name?: string;
  namespace: string;
  operation: "read" | BrainProductToolWriteOperation;
}

export interface ProductResourceDraftInput {
  kind: Exclude<BrainProductToolResourceKind, "EntryPoint">;
  manifest?: unknown;
  name: string;
  namespace: string;
  patch?: unknown;
}

export type ProductResourceDraft =
  | {
      action: "create";
      body: unknown;
      kind: "AP" | "DB";
      name: string;
      namespace: string;
    }
  | {
      action: "patch";
      body: unknown;
      kind: "AP" | "DB";
      name: string;
      namespace: string;
    };

export interface ConfirmedProductWriteInput {
  base?: string;
  confirmed: boolean;
  kind: Exclude<BrainProductToolResourceKind, "EntryPoint">;
  kubeconfig: string;
  manifest?: unknown;
  name: string;
  namespace: string;
  operation: BrainProductToolWriteOperation;
  patch?: unknown;
}

export type ProductWriteOutput =
  | { data: unknown; ok: true }
  | { error: string; ok: false };

export type ProductFetcher = (options: FetcherOptions) => Promise<unknown>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function productRoute(kind: BrainProductToolResourceKind): string {
  if (kind === "AP") {
    return API_ROUTES.ap.root;
  }
  if (kind === "DB") {
    return API_ROUTES.db.root;
  }
  return API_ROUTES.entrypoint.root;
}

function productWriteMethod(
  operation: BrainProductToolWriteOperation
): FetcherOptions["method"] {
  if (operation === "create") {
    return "PUT";
  }
  if (operation === "delete") {
    return "DELETE";
  }
  return "PATCH";
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

function productTargetLabel(input: {
  kind: BrainProductToolResourceKind;
  name?: string;
  namespace: string;
}): string {
  return `${input.kind} ${input.namespace}/${input.name ?? "*"}`;
}

function productCreateBody(manifest: unknown): { yaml: string } | undefined {
  if (manifest === undefined) {
    return undefined;
  }
  if (typeof manifest === "string") {
    return { yaml: manifest.trimEnd() };
  }
  return { yaml: YAML.stringify(manifest).trimEnd() };
}

export function normalizeProductPatch(
  kind: Exclude<BrainProductToolResourceKind, "EntryPoint">,
  patch: unknown
): unknown {
  if (kind !== "AP" || !isPlainRecord(patch) || isPlainRecord(patch.spec)) {
    return patch;
  }

  const productSpecKeys = new Set([
    "input",
    "ingressAnnotations",
    "paused",
    "resource",
    "restartRequest",
  ]);
  const specPatch: Record<string, unknown> = {};
  const topLevelPatch: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (productSpecKeys.has(key)) {
      specPatch[key] = value;
    } else {
      topLevelPatch[key] = value;
    }
  }

  if (Object.keys(specPatch).length === 0) {
    return patch;
  }
  return {
    ...topLevelPatch,
    spec: specPatch,
  };
}

export function buildProductResourceRequest(
  input: ProductResourceRequestInput
): FetcherOptions {
  const name = cleanOptional(input.name);
  const labelSelector = cleanOptional(input.labelSelector);
  const query =
    input.operation === "create"
      ? undefined
      : {
          ...(labelSelector == null ? {} : { "label-selector": labelSelector }),
          ...(name == null ? {} : { name }),
          namespace: input.namespace.trim(),
        };
  return {
    base: input.base ?? "",
    ...(input.body === undefined ? {} : { body: input.body }),
    header: {
      Authorization: `Bearer ${encodeURIComponent(input.kubeconfig)}`,
    },
    method:
      input.operation === "read" ? "GET" : productWriteMethod(input.operation),
    path: productRoute(input.kind),
    ...(query === undefined ? {} : { query }),
  };
}

export function buildProductResourceDraft(
  input: ProductResourceDraftInput
): ProductResourceDraft {
  const manifest = input.manifest;
  if (manifest !== undefined) {
    return {
      action: "create",
      body: manifest,
      kind: input.kind,
      name: input.name.trim(),
      namespace: input.namespace.trim(),
    };
  }
  return {
    action: "patch",
    body: normalizeProductPatch(input.kind, input.patch ?? {}),
    kind: input.kind,
    name: input.name.trim(),
    namespace: input.namespace.trim(),
  };
}

export async function executeConfirmedProductWrite(
  input: ConfirmedProductWriteInput,
  productFetcher: ProductFetcher = fetcher
): Promise<ProductWriteOutput> {
  const invalid = validateWriteBody(input);
  if (invalid != null) {
    return {
      error: invalid.error,
      ok: false,
    };
  }

  if (!input.confirmed) {
    return {
      error: `Refused to write ${productTargetLabel(input)}: confirmed must be true.`,
      ok: false,
    };
  }

  let body: unknown;
  if (input.operation === "create") {
    body = productCreateBody(input.manifest);
  } else if (input.operation === "patch") {
    body = normalizeProductPatch(input.kind, input.patch);
  }
  if (input.operation !== "delete" && body === undefined) {
    return {
      error: `${input.operation} requires a manifest or patch body.`,
      ok: false,
    };
  }

  const request = buildProductResourceRequest({
    body,
    base: input.base,
    kind: input.kind,
    kubeconfig: input.kubeconfig,
    name: input.name,
    namespace: input.namespace,
    operation: input.operation,
  });
  try {
    const data = await productFetcher(request);
    return { data, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Product write failed.",
      ok: false,
    };
  }
}

const productReadInputSchema = z.object({
  intention: chatToolIntentionField,
  kind: z.enum(["AP", "DB", "EntryPoint"]),
  labelSelector: z.string().trim().max(1000).optional(),
  name: z.string().trim().min(1).max(253).optional(),
});

export const draftProductResourceChangeInput = z.object({
  intention: chatToolIntentionField,
  kind: z.enum(["AP", "DB"]),
  manifest: z.unknown().optional(),
  name: z.string().trim().min(1).max(253),
  namespace: z.string().trim().min(1).max(253).optional(),
  patch: z.unknown().optional(),
});

const productWriteInputSchema = z.object({
  intention: chatToolIntentionField,
  kind: z.enum(["AP", "DB"]),
  manifest: z.unknown().optional(),
  name: z.string().trim().min(1).max(253),
  operation: z.enum(["create", "delete", "patch"]),
  patch: z.unknown().optional(),
});

function validateDraftBody(input: {
  manifest?: unknown;
  patch?: unknown;
}): { error: string } | null {
  if (input.manifest !== undefined && input.patch !== undefined) {
    return { error: "Provide either manifest or patch, not both." };
  }
  if (input.manifest === undefined && input.patch === undefined) {
    return { error: "Draft requires either manifest or patch." };
  }
  return null;
}

function validateWriteBody(input: {
  manifest?: unknown;
  operation: BrainProductToolWriteOperation;
  patch?: unknown;
}): { error: string } | null {
  if (input.operation === "delete") {
    if (input.manifest !== undefined || input.patch !== undefined) {
      return { error: "Delete does not accept manifest or patch body." };
    }
    return null;
  }
  return validateDraftBody(input);
}

export function createChatProductTools(options: {
  kubeconfig: string;
  kubernetesNamespace: string;
}) {
  const namespace = options.kubernetesNamespace;
  const kubeconfig = options.kubeconfig;

  const readProductResource = tool({
    description: [
      "Read Brain product resources through the direct AP, DB, or EntryPoint product APIs.",
      "Use this before answering resource-specific AP/DB/EntryPoint questions or before proposing a mutation.",
      "This is preferred over kubectl for normal Brain product inspection.",
      "For a single AP/DB, pass kind + name. For lists, omit name and optionally pass labelSelector. EntryPoint is read-only and is AP-bound derived state.",
    ].join(" "),
    inputSchema: productReadInputSchema,
    execute: async (input) => {
      logChatToolIntention("readProductResource", input.intention);
      const data = await fetcher(
        buildProductResourceRequest({
          kind: input.kind,
          kubeconfig,
          labelSelector: input.labelSelector,
          name: input.name,
          namespace,
          operation: "read",
          base: ApiUrl(),
        })
      );
      return { data, ok: true };
    },
  });

  const draftProductResourceChange = tool({
    description: [
      "Draft a Brain AP/DB product change without applying it.",
      "Use this to show the user the exact create manifest or merge patch that would be sent to the product API.",
      "For EntryPoint/public-address changes, draft the AP network change instead because EntryPoint is AP-bound derived state.",
    ].join(" "),
    inputSchema: draftProductResourceChangeInput,
    execute: (input) => {
      logChatToolIntention("draftProductResourceChange", input.intention);
      const invalid = validateDraftBody(input);
      if (invalid != null) {
        return {
          error: invalid.error,
          ok: false,
        };
      }
      return {
        draft: buildProductResourceDraft({
          kind: input.kind,
          manifest: input.manifest,
          name: input.name,
          namespace: input.namespace ?? namespace,
          patch: input.patch,
        }),
        ok: true,
      };
    },
  });

  const writeProductResource = tool({
    description: [
      "Apply a confirmed Brain AP/DB product write through the direct product API.",
      "This tool always requests browser UI approval before execution; call it only when the user has asked to apply the exact intended change.",
      "If approval is missing, call draftProductResourceChange or ask for confirmation instead.",
      "Never use this for EntryPoint writes; public address/domain changes belong in the AP network intent.",
    ].join(" "),
    inputSchema: productWriteInputSchema,
    needsApproval: true,
    execute: (input) => {
      logChatToolIntention("writeProductResource", input.intention);
      return executeConfirmedProductWrite({
        confirmed: true,
        base: ApiUrl(),
        kind: input.kind,
        kubeconfig,
        manifest: input.manifest,
        name: input.name,
        namespace,
        operation: input.operation,
        patch: input.patch,
      });
    },
  });

  return {
    draftProductResourceChange,
    readProductResource,
    writeProductResource,
  };
}
