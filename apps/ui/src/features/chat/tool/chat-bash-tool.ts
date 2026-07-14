import "server-only";

import { type Tool, tool } from "ai";
import {
  type BashToolkit,
  type CommandResult,
  type CreateBashToolOptions,
  createBashTool,
} from "bash-tool";
import { z } from "zod";

import {
  type ChatDevboxSandbox,
  createChatDevboxSandbox,
} from "../devbox/chat-runtime";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "./chat-tool-intention";

/** Directory `bash-tool` uses for relative read/write paths. */
const CHAT_BASH_WORKING_DIRECTORY = "/tmp";

/**
 * Static bash-tool prompt so `createBashTool` skips tool discovery, which would
 * otherwise force Devbox startup on every chat request.
 */
const DEVBOX_BASH_TOOL_PROMPT = [
  "Environment: typical Linux userland (grep, sed, awk, find, curl, common coreutils).",
  "kubectl is available in the Devbox runtime with the connected namespace permissions.",
].join("\n");

const TOOL_ERROR_JSON_MAX = 4000;

function jsonSnippet(value: unknown, max = TOOL_ERROR_JSON_MAX): string {
  try {
    const s = JSON.stringify(value);
    return s.length > max ? `${s.slice(0, max)}...` : s;
  } catch {
    return "[unserializable]";
  }
}

/**
 * Human-readable tool failure for logs and `useChat` tool `errorText`
 * (AI SDK surfaces `Error.message` on `output-error`).
 */
function describeChatToolError(
  toolLabel: string,
  error: unknown,
  depth = 0
): string {
  if (depth > 4) {
    return `${toolLabel}: [cause chain truncated]`;
  }
  if (error instanceof Error) {
    if (error.cause === undefined) {
      return `${toolLabel}: ${error.name}: ${error.message}`;
    }
    const cause = describeChatToolError("cause", error.cause, depth + 1);
    return `${toolLabel}: ${error.name}: ${error.message} | cause: ${cause}`;
  }
  return `${toolLabel}: ${jsonSnippet(error)}`;
}

function wrapChatBashTool<T>(toolDef: T, toolLabel: string): T {
  if (toolDef === null || typeof toolDef !== "object") {
    return toolDef;
  }
  const originalExecute = Reflect.get(toolDef as object, "execute");
  if (typeof originalExecute !== "function") {
    return toolDef;
  }
  return {
    ...(toolDef as object),
    execute: async (...args: unknown[]) => {
      try {
        return await Reflect.apply(
          originalExecute as (...inner: unknown[]) => Promise<unknown>,
          toolDef,
          args
        );
      } catch (error) {
        const detail = describeChatToolError(toolLabel, error);
        console.error(`[createChatBashTool:${toolLabel}]`, detail, error);
        throw new Error(detail);
      }
    },
  } as T;
}

type BashInnerExecuteFn = (args: { command: string }) => Promise<unknown>;
type ReadFileInnerExecuteFn = (args: { path: string }) => Promise<unknown>;
type WriteFileInnerExecuteFn = (args: {
  path: string;
  content: string;
}) => Promise<unknown>;

/** Extends upstream `bash` tool input so the model declares why it is running shell. */
const bashWithIntentionInputSchema = z.object({
  command: z.string().describe("The bash command to execute."),
  intention: chatToolIntentionField,
});

const readFileWithIntentionInputSchema = z.object({
  intention: chatToolIntentionField,
  path: z.string().describe("The path to the file to read"),
});

const writeFileWithIntentionInputSchema = z.object({
  intention: chatToolIntentionField,
  path: z.string().describe("The path where the file should be written"),
  content: z.string().describe("The content to write to the file"),
});

export type BashToolWithIntentionInput = z.infer<
  typeof bashWithIntentionInputSchema
>;

export type ChatBashReadFileInput = z.infer<
  typeof readFileWithIntentionInputSchema
>;

export type ChatBashWriteFileInput = z.infer<
  typeof writeFileWithIntentionInputSchema
>;

export type ChatBashBashTool = Tool<BashToolWithIntentionInput, CommandResult>;
export type ChatBashReadFileTool = Tool<
  ChatBashReadFileInput,
  { content: string }
>;

export type ChatBashWriteFileTool = Tool<
  ChatBashWriteFileInput,
  { success: true }
>;

export type ChatBashToolkit = Omit<BashToolkit, "bash" | "tools"> & {
  bash: ChatBashBashTool;
  tools: Omit<BashToolkit["tools"], "bash" | "readFile" | "writeFile"> & {
    bash: ChatBashBashTool;
    readFile: ChatBashReadFileTool;
    writeFile: ChatBashWriteFileTool;
  };
};

/**
 * Layers `intention` on `bash-tool`'s `bash` primitive; execution still ignores it beyond logging.
 *
 * Keeps `{ command }` contract for upstream `bash-tool`; never mutate their schema in node_modules.
 */
function augmentBashToolWithIntention(innerUnknown: unknown) {
  const inner = innerUnknown as { description?: string };
  const origExecuteUnknown = Reflect.get(innerUnknown as object, "execute");

  const baseDesc =
    typeof inner.description === "string" ? inner.description : "";
  const enrichedDescription = `${baseDesc}

INTENTION:
Always set \`intention\`--one or two clauses on what cluster/Devbox work this command advances (e.g. verify rollout in namespace X). Execution uses \`command\` only; \`intention\` is for auditability/transcripts and is echoed to server logs.`.trimStart();

  return tool<BashToolWithIntentionInput, CommandResult>({
    description: enrichedDescription,
    inputSchema: bashWithIntentionInputSchema,
    execute: async (input) => {
      logChatToolIntention("bash", input.intention);
      const out = await Reflect.apply(
        origExecuteUnknown as BashInnerExecuteFn,
        innerUnknown,
        [{ command: input.command }]
      );
      return out as CommandResult;
    },
  });
}

/** Same pattern as bash: forwards `path` only; logs `intention`. */
function augmentReadFileToolWithIntention(innerUnknown: unknown) {
  const inner = innerUnknown as { description?: string };
  const origExecuteUnknown = Reflect.get(innerUnknown as object, "execute");
  const baseDesc =
    typeof inner.description === "string" ? inner.description : "";

  const enrichedDescription = `${baseDesc}

INTENTION:
Always set \`intention\`; execution uses only \`path\`.`;

  return tool<ChatBashReadFileInput, { content: string }>({
    description: enrichedDescription,
    inputSchema: readFileWithIntentionInputSchema,
    execute: async (input) => {
      logChatToolIntention("readFile", input.intention);
      const out = await Reflect.apply(
        origExecuteUnknown as ReadFileInnerExecuteFn,
        innerUnknown,
        [{ path: input.path }]
      );
      return out as { content: string };
    },
  });
}

function augmentWriteFileToolWithIntention(innerUnknown: unknown) {
  const inner = innerUnknown as { description?: string };
  const origExecuteUnknown = Reflect.get(innerUnknown as object, "execute");
  const baseDesc =
    typeof inner.description === "string" ? inner.description : "";

  const enrichedDescription = `${baseDesc}

INTENTION:
Always set \`intention\`; execution uses only \`path\` + \`content\`.`;

  return tool<ChatBashWriteFileInput, { success: true }>({
    description: enrichedDescription,
    inputSchema: writeFileWithIntentionInputSchema,
    execute: async (input) => {
      logChatToolIntention("writeFile", input.intention);
      const out = await Reflect.apply(
        origExecuteUnknown as WriteFileInnerExecuteFn,
        innerUnknown,
        [{ content: input.content, path: input.path }]
      );
      return out as { success: true };
    },
  });
}

export interface CreateChatBashToolRuntimeOptions {
  /** Decoded kubeconfig YAML, used only for stable Devbox runtime identity. */
  kubeconfig: string;
  /** Authoritative Kubernetes namespace for Devbox permission checks. */
  namespace: string;
}

export type CreateChatBashToolOptions = Omit<CreateBashToolOptions, "sandbox"> &
  CreateChatBashToolRuntimeOptions;

/**
 * Chat-facing bash tools backed by a lazy Sealos Devbox runtime.
 *
 * Avoid `files` / `uploadDirectory` if you need runtime startup to be deferred
 * until the first tool call.
 */
export async function createChatBashTool(
  options: CreateChatBashToolOptions
): Promise<ChatBashToolkit & { lazySandbox: ChatDevboxSandbox }> {
  const { kubeconfig, namespace, promptOptions, ...bashToolOptions } = options;
  const lazySandbox = createChatDevboxSandbox({
    kubeconfig,
    namespace,
  });
  const toolkit = await createBashTool({
    ...bashToolOptions,
    destination: bashToolOptions.destination ?? CHAT_BASH_WORKING_DIRECTORY,
    sandbox: lazySandbox,
    promptOptions: {
      ...promptOptions,
      toolPrompt: promptOptions?.toolPrompt ?? DEVBOX_BASH_TOOL_PROMPT,
    },
  });

  const bashWithIntention = augmentBashToolWithIntention(toolkit.tools.bash);
  const wrappedBash = wrapChatBashTool(bashWithIntention, "bash");
  const readWithIntention = augmentReadFileToolWithIntention(
    toolkit.tools.readFile
  );
  const wrappedReadFile = wrapChatBashTool(readWithIntention, "readFile");
  const writeWithIntention = augmentWriteFileToolWithIntention(
    toolkit.tools.writeFile
  );
  const wrappedWriteFile = wrapChatBashTool(writeWithIntention, "writeFile");

  return {
    ...toolkit,
    bash: wrappedBash,
    lazySandbox,
    tools: {
      bash: wrappedBash,
      readFile: wrappedReadFile,
      writeFile: wrappedWriteFile,
    },
  };
}
