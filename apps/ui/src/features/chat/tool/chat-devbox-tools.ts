import "server-only";

import path from "node:path";
import { type ToolExecutionOptions, tool } from "ai";
import { z } from "zod";

import {
  type ChatDevboxSandbox,
  createChatDevboxSandbox,
} from "../devbox/chat-runtime";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "./chat-tool-intention";

export const CHAT_DEVBOX_WORKSPACE = "/home/devbox/project/workspace";
const MAX_TEXT_BYTES = 50 * 1024;
const MAX_TEXT_LINES = 2000;
const MAX_EDIT_OPERATIONS = 32;
const MAX_BASH_TIMEOUT_SECONDS = 60;
const mutationQueues = new Map<string, Promise<void>>();
const PATH_CONTROL_CHARACTERS = /[\0\r\n]/;

const safePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) => !PATH_CONTROL_CHARACTERS.test(value),
    "Path contains control characters."
  );

const readInputSchema = z
  .object({
    intention: chatToolIntentionField,
    limit: z.number().int().min(1).max(MAX_TEXT_LINES).optional(),
    offset: z.number().int().min(1).optional(),
    path: safePathSchema,
  })
  .strict();

const writeInputSchema = z
  .object({
    content: z.string(),
    intention: chatToolIntentionField,
    path: safePathSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (Buffer.byteLength(input.content, "utf8") > MAX_TEXT_BYTES) {
      context.addIssue({
        code: "custom",
        message: `File content exceeds ${MAX_TEXT_BYTES} UTF-8 bytes.`,
        path: ["content"],
      });
    }
  });

const editOperationSchema = z
  .object({
    newText: z.string(),
    oldText: z.string().min(1),
  })
  .strict();

const editInputSchema = z
  .object({
    edits: z.array(editOperationSchema).min(1).max(MAX_EDIT_OPERATIONS),
    intention: chatToolIntentionField,
    path: safePathSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const bytes = input.edits.reduce(
      (total, edit) =>
        total +
        Buffer.byteLength(edit.oldText, "utf8") +
        Buffer.byteLength(edit.newText, "utf8"),
      0
    );
    if (bytes > MAX_TEXT_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Edit content exceeds ${MAX_TEXT_BYTES} UTF-8 bytes.`,
        path: ["edits"],
      });
    }
  });

const bashInputSchema = z
  .object({
    command: z
      .string()
      .min(1)
      .max(16 * 1024),
    intention: chatToolIntentionField,
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_BASH_TIMEOUT_SECONDS)
      .optional(),
  })
  .strict();

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isWithinWorkspace(candidate: string): boolean {
  return (
    candidate === CHAT_DEVBOX_WORKSPACE ||
    candidate.startsWith(`${CHAT_DEVBOX_WORKSPACE}/`)
  );
}

async function resolveWorkspacePath(
  sandbox: ChatDevboxSandbox,
  requestedPath: string
): Promise<string> {
  const lexicalPath = path.posix.isAbsolute(requestedPath)
    ? path.posix.normalize(requestedPath)
    : path.posix.resolve(CHAT_DEVBOX_WORKSPACE, requestedPath);
  if (!isWithinWorkspace(lexicalPath)) {
    throw new Error(
      `Path must stay within the Devbox workspace: ${CHAT_DEVBOX_WORKSPACE}`
    );
  }

  const result = await sandbox.executeCommand(
    `realpath -m -- ${shellQuote(lexicalPath)}`
  );
  if (result.exitCode !== 0) {
    throw new Error(`Could not resolve Devbox path: ${result.stderr}`.trim());
  }
  const canonicalPath = result.stdout.endsWith("\n")
    ? result.stdout.slice(0, -1)
    : result.stdout;
  if (!isWithinWorkspace(canonicalPath)) {
    throw new Error("Resolved path escapes the Devbox workspace.");
  }
  return canonicalPath;
}

interface TruncatedText {
  content: string;
  truncated: boolean;
}

function truncateUtf8(value: string, maxBytes: number): TruncatedText {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return { content: value, truncated: false };
  }
  const bytes = Buffer.from(value, "utf8");
  let content = bytes.subarray(0, maxBytes).toString("utf8");
  while (content.endsWith("�")) {
    content = content.slice(0, -1);
  }
  return { content, truncated: true };
}

export function sliceReadContent(
  source: string,
  offset = 1,
  limit = MAX_TEXT_LINES
) {
  const lines = source.split("\n");
  const selected = lines.slice(offset - 1, offset - 1 + limit);
  const byLines = selected.join("\n");
  const byBytes = truncateUtf8(byLines, MAX_TEXT_BYTES);
  const displayedLineCount =
    byBytes.content.length === 0 ? 0 : byBytes.content.split("\n").length;
  const truncated =
    byBytes.truncated || offset - 1 + selected.length < lines.length;
  return {
    content: byBytes.content,
    nextOffset:
      truncated && !byBytes.truncated ? offset + displayedLineCount : undefined,
    truncated,
  };
}

function truncateCommandOutput(value: string): TruncatedText {
  const lines = value.split("\n");
  const lineBounded =
    lines.length > MAX_TEXT_LINES
      ? lines.slice(-MAX_TEXT_LINES).join("\n")
      : value;
  if (Buffer.byteLength(lineBounded, "utf8") <= MAX_TEXT_BYTES) {
    return {
      content: lineBounded,
      truncated: lineBounded !== value,
    };
  }
  const bytes = Buffer.from(lineBounded, "utf8");
  let content = bytes.subarray(bytes.length - MAX_TEXT_BYTES).toString("utf8");
  if (content.startsWith("�")) {
    content = content.slice(1);
  }
  return { content, truncated: true };
}

function normalizeEol(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

export function applyExactEdits(
  source: string,
  edits: { newText: string; oldText: string }[]
): string {
  const hasBom = source.startsWith("\uFEFF");
  const withoutBom = hasBom ? source.slice(1) : source;
  const eol = withoutBom.includes("\r\n") ? "\r\n" : "\n";
  const normalizedSource = normalizeEol(withoutBom);
  const ranges = edits.map((edit, index) => {
    const oldText = normalizeEol(edit.oldText);
    const start = normalizedSource.indexOf(oldText);
    if (start < 0) {
      throw new Error(`Edit ${index + 1} oldText was not found exactly.`);
    }
    if (normalizedSource.indexOf(oldText, start + oldText.length) >= 0) {
      throw new Error(`Edit ${index + 1} oldText is not unique.`);
    }
    return {
      end: start + oldText.length,
      newText: normalizeEol(edit.newText),
      start,
    };
  });

  const ordered = [...ranges].sort((a, b) => a.start - b.start);
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = ordered[index - 1];
    if (
      current !== undefined &&
      previous !== undefined &&
      current.start < previous.end
    ) {
      throw new Error("Edit ranges overlap.");
    }
  }

  let result = normalizedSource;
  for (const range of ordered.reverse()) {
    result = `${result.slice(0, range.start)}${range.newText}${result.slice(range.end)}`;
  }
  const restored = eol === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
  return hasBom ? `\uFEFF${restored}` : restored;
}

async function serializeMutation<T>(
  filePath: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = mutationQueues.get(filePath) ?? Promise.resolve();
  const queued = previous.catch(() => undefined).then(operation);
  const settled = queued.then(
    () => undefined,
    () => undefined
  );
  mutationQueues.set(filePath, settled);
  try {
    return await queued;
  } finally {
    if (mutationQueues.get(filePath) === settled) {
      mutationQueues.delete(filePath);
    }
  }
}

function executeWithSignal<T>(
  sandbox: ChatDevboxSandbox,
  options: ToolExecutionOptions<unknown>,
  operation: () => Promise<T>
): Promise<T> {
  return sandbox.runWithAbortSignal(options.abortSignal, operation);
}

export interface CreateChatDevboxToolsOptions {
  kubeconfig: string;
  namespace: string;
}

export function createChatDevboxTools(options: CreateChatDevboxToolsOptions) {
  const lazySandbox = createChatDevboxSandbox(options);

  const read = tool({
    description: `Read a UTF-8 text file under ${CHAT_DEVBOX_WORKSPACE}. Prefer this to shell cat/sed. Results are capped at ${MAX_TEXT_LINES} lines or ${MAX_TEXT_BYTES} bytes; use offset to continue.`,
    inputSchema: readInputSchema,
    execute: (input, executionOptions) =>
      executeWithSignal(lazySandbox, executionOptions, async () => {
        logChatToolIntention("read", input.intention);
        const resolvedPath = await resolveWorkspacePath(
          lazySandbox,
          input.path
        );
        const offset = input.offset ?? 1;
        const limit = input.limit ?? MAX_TEXT_LINES;
        const result = await lazySandbox.executeCommand(
          [
            `if test -f -- ${shellQuote(resolvedPath)}; then`,
            `  tail -n +${offset} -- ${shellQuote(resolvedPath)} | head -n ${limit + 1} | head -c ${MAX_TEXT_BYTES + 1}`,
            "else",
            `  echo ${shellQuote("Devbox read target is not a regular file.")} >&2`,
            "  exit 1",
            "fi",
          ].join("\n")
        );
        if (result.exitCode !== 0) {
          throw new Error(`Devbox file read failed: ${result.stderr}`.trim());
        }
        const sliced = sliceReadContent(result.stdout, 1, limit);
        return {
          ...sliced,
          nextOffset:
            sliced.nextOffset === undefined
              ? undefined
              : offset + sliced.nextOffset - 1,
          path: resolvedPath,
        };
      }),
  });

  const write = tool({
    description: `Create or completely overwrite one UTF-8 text file under ${CHAT_DEVBOX_WORKSPACE}. Parent directories are created. Use edit for precise changes.`,
    inputSchema: writeInputSchema,
    execute: (input, executionOptions) =>
      executeWithSignal(lazySandbox, executionOptions, async () => {
        logChatToolIntention("write", input.intention);
        const resolvedPath = await resolveWorkspacePath(
          lazySandbox,
          input.path
        );
        return await serializeMutation(resolvedPath, async () => {
          await lazySandbox.writeFiles([
            { content: input.content, path: resolvedPath },
          ]);
          return {
            bytesWritten: Buffer.byteLength(input.content, "utf8"),
            path: resolvedPath,
            success: true as const,
          };
        });
      }),
  });

  const edit = tool({
    description: `Apply up to ${MAX_EDIT_OPERATIONS} exact, unique, non-overlapping text replacements to one UTF-8 file under ${CHAT_DEVBOX_WORKSPACE}. All matches are checked against the original file; BOM and line endings are preserved.`,
    inputSchema: editInputSchema,
    execute: (input, executionOptions) =>
      executeWithSignal(lazySandbox, executionOptions, async () => {
        logChatToolIntention("edit", input.intention);
        const resolvedPath = await resolveWorkspacePath(
          lazySandbox,
          input.path
        );
        return await serializeMutation(resolvedPath, async () => {
          const original = await lazySandbox.readFile(resolvedPath);
          const updated = applyExactEdits(original, input.edits);
          await lazySandbox.writeFiles([
            { content: updated, path: resolvedPath },
          ]);
          return {
            path: resolvedPath,
            replacements: input.edits.length,
            success: true as const,
          };
        });
      }),
  });

  const bash = tool({
    description: `Run an approved shell command in the remote Devbox, starting in ${CHAT_DEVBOX_WORKSPACE}. Use product tools first; use bash for diagnosis, evidence gathering, and emergency recovery. Output keeps the last ${MAX_TEXT_LINES} lines or ${MAX_TEXT_BYTES} bytes.`,
    inputSchema: bashInputSchema,
    execute: (input, executionOptions) =>
      executeWithSignal(lazySandbox, executionOptions, async () => {
        logChatToolIntention("bash", input.intention);
        const command = [
          "set -euo pipefail",
          `mkdir -p -- ${shellQuote(CHAT_DEVBOX_WORKSPACE)}`,
          `cd -- ${shellQuote(CHAT_DEVBOX_WORKSPACE)}`,
          input.command,
        ].join("\n");
        const result = await lazySandbox.executeCommand(
          command,
          input.timeoutSeconds
        );
        const stdout = truncateCommandOutput(result.stdout);
        const stderr = truncateCommandOutput(result.stderr);
        return {
          exitCode: result.exitCode,
          stderr: stderr.content,
          stdout: stdout.content,
          truncated: stdout.truncated || stderr.truncated,
        };
      }),
  });

  return {
    lazySandbox,
    tools: { bash, edit, read, write },
  };
}
