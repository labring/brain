import "server-only";

import path from "node:path";
import { type ToolExecutionOptions, tool } from "ai";
import { z } from "zod";
import {
  type ChatDevboxSandbox,
  createChatDevboxSandbox,
} from "../devbox/chat-runtime";
import { logChatToolIntention } from "./chat-tool-intention";
import { DEVBOX_IO_SCRIPT } from "./devbox-io";
import {
  bashInputSchema,
  CHAT_DEVBOX_WORKSPACE,
  editInputSchema,
  readInputSchema,
  writeInputSchema,
} from "./devbox-tool-input";

const resultSchema = z
  .object({
    content: z.string().optional(),
    path: z.string().optional(),
    nextOffset: z.number().optional(),
    truncated: z.boolean().optional(),
    success: z.boolean().optional(),
    bytesWritten: z.number().optional(),
    replacements: z.number().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().optional(),
    timedOut: z.boolean().optional(),
    error: z.string().optional(),
  })
  .strict();

function workspacePath(requested: string): string {
  const resolved = path.posix.resolve(CHAT_DEVBOX_WORKSPACE, requested);
  if (!resolved.startsWith(`${CHAT_DEVBOX_WORKSPACE}/`)) {
    throw new Error("Path must stay within the Devbox workspace.");
  }
  return path.posix.relative(CHAT_DEVBOX_WORKSPACE, resolved);
}

async function executeRemote(
  sandbox: ChatDevboxSandbox,
  operation: "read" | "write" | "edit" | "bash",
  input: { intention: string; path?: string; timeoutSeconds?: number },
  options: ToolExecutionOptions<unknown>
) {
  return await sandbox.runWithAbortSignal(options.abortSignal, async () => {
    options.abortSignal?.throwIfAborted();
    logChatToolIntention(operation, input.intention);
    const relative =
      input.path === undefined ? undefined : workspacePath(input.path);
    const request = {
      ...input,
      operation,
      root: CHAT_DEVBOX_WORKSPACE,
      ...(relative === undefined ? {} : { path: relative }),
    };
    const encoded = Buffer.from(JSON.stringify(request)).toString("base64");
    // Python isolated mode ignores workspace modules and PYTHON* environment hooks.
    const command = `/usr/bin/python3 -I - '${encoded}' <<'BRAIN_DEVBOX_IO'\n${DEVBOX_IO_SCRIPT}\nBRAIN_DEVBOX_IO`;
    const response = await sandbox.executeCommand(
      command,
      (input.timeoutSeconds ?? 60) + 5
    );
    if (response.exitCode !== 0) {
      throw new Error(
        "Devbox operation failed or timed out. The runtime must provide /usr/bin/python3."
      );
    }
    // The helper bounds output before transport. This check also rejects malformed runtime responses.
    if (Buffer.byteLength(response.stdout) > 700_000) {
      throw new Error("Devbox returned an oversized operation response.");
    }
    const result = resultSchema.parse(JSON.parse(response.stdout));
    if (result.error !== undefined) {
      throw new Error(result.error);
    }
    return {
      ...result,
      ...(relative === undefined
        ? {}
        : { path: `${CHAT_DEVBOX_WORKSPACE}/${relative}` }),
    };
  });
}

export interface CreateChatDevboxToolsOptions {
  kubeconfig: string;
  namespace: string;
}

export function createChatDevboxTools(options: CreateChatDevboxToolsOptions) {
  const lazySandbox = createChatDevboxSandbox(options);
  const read = tool({
    description: `Read UTF-8 text under ${CHAT_DEVBOX_WORKSPACE}. Symlinks and hard links are rejected. Results preserve line endings and are capped at 2000 lines or 50 KiB. Continue only when nextOffset is returned.`,
    inputSchema: readInputSchema,
    execute: (input, executionOptions) =>
      executeRemote(
        lazySandbox,
        "read",
        readInputSchema.parse(input),
        executionOptions
      ),
  });
  const write = tool({
    description: `Create or replace a UTF-8 file under ${CHAT_DEVBOX_WORKSPACE}, up to 50 KiB. Parent directories are created. Symlinks and hard links are rejected; replacement is atomic. Use edit for precise changes.`,
    inputSchema: writeInputSchema,
    needsApproval: true,
    execute: (input, executionOptions) =>
      executeRemote(
        lazySandbox,
        "write",
        writeInputSchema.parse(input),
        executionOptions
      ),
  });
  const edit = tool({
    description: `Apply up to 32 exact, unique, non-overlapping replacements under ${CHAT_DEVBOX_WORKSPACE}. Both original and resulting files must fit 50 KiB. Symlinks and hard links are rejected. BOM and line endings are preserved.`,
    inputSchema: editInputSchema,
    needsApproval: true,
    execute: (input, executionOptions) =>
      executeRemote(
        lazySandbox,
        "edit",
        editInputSchema.parse(input),
        executionOptions
      ),
  });
  const bash = tool({
    description: `Run an approved bash command starting in ${CHAT_DEVBOX_WORKSPACE}, with normal bash login-shell semantics. Use product tools first. Each output stream keeps at most its last 2000 lines and 50 KiB inside the Devbox. Timeout includes waiting for other tools in this Devbox; background descendants are stopped when the call ends.`,
    inputSchema: bashInputSchema,
    needsApproval: true,
    execute: (input, executionOptions) =>
      executeRemote(
        lazySandbox,
        "bash",
        bashInputSchema.parse(input),
        executionOptions
      ),
  });
  return { lazySandbox, tools: { bash, edit, read, write } };
}
