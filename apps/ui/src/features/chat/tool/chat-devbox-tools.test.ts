import { mock, test } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));

const invocationSignals: (AbortSignal | undefined)[] = [];
const commands: { command: string; timeoutSeconds?: number }[] = [];
const files = new Map<string, string>();
const ESCAPED_PATH_ERROR = /must stay within/;
const MISSING_EDIT_ERROR = /not found/;
const NON_UNIQUE_EDIT_ERROR = /not unique/;
const OVERLAPPING_EDIT_ERROR = /overlap/;
const SYMLINK_ESCAPE_ERROR = /Resolved path escapes/;
let resolveRealpath = (requestedPath: string) => requestedPath;
let writeFiles = (writes: { content: string; path: string }[]) => {
  for (const write of writes) {
    files.set(write.path, write.content);
  }
  return Promise.resolve();
};

const sandbox = {
  executeCommand: (command: string, timeoutSeconds?: number) => {
    commands.push({ command, timeoutSeconds });
    if (command.startsWith("realpath -m -- ")) {
      const quotedPath = command.slice("realpath -m -- ".length);
      return Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: `${resolveRealpath(quotedPath.slice(1, -1))}\n`,
      });
    }
    return Promise.resolve({ exitCode: 0, stderr: "", stdout: "ok" });
  },
  getDevboxName: async () => "chat-runtime",
  readFile: async (path: string) => files.get(path) ?? "",
  runWithAbortSignal: async <T>(
    signal: AbortSignal | undefined,
    operation: () => Promise<T>
  ) => {
    invocationSignals.push(signal);
    return await operation();
  },
  stop: () => Promise.resolve(),
  writeFiles: (writes: { content: string; path: string }[]) =>
    writeFiles(writes),
};

mock.module("../devbox/chat-runtime", () => ({
  createChatDevboxSandbox: () => sandbox,
}));

const {
  CHAT_DEVBOX_WORKSPACE,
  applyExactEdits,
  createChatDevboxTools,
  sliceReadContent,
} = await import("./chat-devbox-tools");

function executeTool(
  toolDefinition: object,
  input: unknown,
  signal?: AbortSignal
) {
  const execute = Reflect.get(toolDefinition, "execute");
  if (typeof execute !== "function") {
    throw new Error("expected tool execute function");
  }
  return Reflect.apply(execute, toolDefinition, [
    input,
    { abortSignal: signal, messages: [], toolCallId: "call-1" },
  ]) as Promise<unknown>;
}

test("Devbox tools expose Pi-style names and forward abort signals", async () => {
  invocationSignals.length = 0;
  const controller = new AbortController();
  const toolkit = createChatDevboxTools({
    kubeconfig: "apiVersion: v1",
    namespace: "ns-test",
  });

  assert.deepEqual(Object.keys(toolkit.tools).sort(), [
    "bash",
    "edit",
    "read",
    "write",
  ]);
  await executeTool(
    toolkit.tools.read,
    { intention: "inspect the test file", path: "a.txt" },
    controller.signal
  );
  await executeTool(
    toolkit.tools.write,
    { content: "value", intention: "write the test file", path: "a.txt" },
    controller.signal
  );

  assert.deepEqual(invocationSignals, [controller.signal, controller.signal]);
});

test("write and edit stay inside the workspace and preserve CRLF plus BOM", async () => {
  files.clear();
  const filePath = `${CHAT_DEVBOX_WORKSPACE}/config.txt`;
  files.set(filePath, "\uFEFFalpha\r\nbeta\r\n");
  const toolkit = createChatDevboxTools({
    kubeconfig: "apiVersion: v1",
    namespace: "ns-test",
  });

  await executeTool(toolkit.tools.edit, {
    edits: [{ newText: "gamma\ndelta", oldText: "beta" }],
    intention: "update the reviewed config",
    path: "config.txt",
  });

  assert.equal(files.get(filePath), "\uFEFFalpha\r\ngamma\r\ndelta\r\n");
  await assert.rejects(
    executeTool(toolkit.tools.write, {
      content: "nope",
      intention: "attempt an escaped write",
      path: "../../outside.txt",
    }),
    ESCAPED_PATH_ERROR
  );
});

test("file tools reject a workspace symlink that resolves outside the root", async () => {
  resolveRealpath = () => "/etc/passwd";
  const toolkit = createChatDevboxTools({
    kubeconfig: "apiVersion: v1",
    namespace: "ns-test",
  });
  try {
    await assert.rejects(
      executeTool(toolkit.tools.read, {
        intention: "inspect a linked workspace file",
        path: "linked-file",
      }),
      SYMLINK_ESCAPE_ERROR
    );
  } finally {
    resolveRealpath = (requestedPath) => requestedPath;
  }
});

test("mutations to the same canonical path execute serially", async () => {
  let writeCount = 0;
  let releaseFirstWrite: () => void = () => undefined;
  const firstWriteBlocked = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  let markFirstWriteStarted: () => void = () => undefined;
  const firstWriteStarted = new Promise<void>((resolve) => {
    markFirstWriteStarted = resolve;
  });
  writeFiles = async (writes) => {
    writeCount += 1;
    if (writeCount === 1) {
      markFirstWriteStarted();
      await firstWriteBlocked;
    }
    for (const write of writes) {
      files.set(write.path, write.content);
    }
  };
  const toolkit = createChatDevboxTools({
    kubeconfig: "apiVersion: v1",
    namespace: "ns-test",
  });
  const first = executeTool(toolkit.tools.write, {
    content: "first",
    intention: "write the first serialized value",
    path: "queued.txt",
  });
  await firstWriteStarted;
  const second = executeTool(toolkit.tools.write, {
    content: "second",
    intention: "write the second serialized value",
    path: "queued.txt",
  });
  await Promise.resolve();
  assert.equal(writeCount, 1);
  releaseFirstWrite();
  try {
    await Promise.all([first, second]);
    assert.equal(writeCount, 2);
    assert.equal(files.get(`${CHAT_DEVBOX_WORKSPACE}/queued.txt`), "second");
  } finally {
    writeFiles = (writes) => {
      for (const write of writes) {
        files.set(write.path, write.content);
      }
      return Promise.resolve();
    };
  }
});

test("exact edits reject missing, duplicate, and overlapping matches", () => {
  assert.throws(
    () => applyExactEdits("one two", [{ newText: "x", oldText: "missing" }]),
    MISSING_EDIT_ERROR
  );
  assert.throws(
    () => applyExactEdits("one one", [{ newText: "x", oldText: "one" }]),
    NON_UNIQUE_EDIT_ERROR
  );
  assert.throws(
    () =>
      applyExactEdits("abcdef", [
        { newText: "x", oldText: "abc" },
        { newText: "y", oldText: "bc" },
      ]),
    OVERLAPPING_EDIT_ERROR
  );
});

test("read slicing reports continuation and bounds UTF-8 output", () => {
  assert.deepEqual(sliceReadContent("one\ntwo\nthree", 2, 1), {
    content: "two",
    nextOffset: 3,
    truncated: true,
  });
  const bounded = sliceReadContent("好".repeat(30_000));
  assert.equal(Buffer.byteLength(bounded.content, "utf8") <= 50 * 1024, true);
  assert.equal(bounded.truncated, true);
});

test("bash starts in the workspace and honors the approved timeout", async () => {
  commands.length = 0;
  const toolkit = createChatDevboxTools({
    kubeconfig: "apiVersion: v1",
    namespace: "ns-test",
  });
  await executeTool(toolkit.tools.bash, {
    command: "pwd",
    intention: "verify the workspace path",
    timeoutSeconds: 12,
  });

  assert.equal(
    commands.at(-1)?.command.includes(`cd -- '${CHAT_DEVBOX_WORKSPACE}'`),
    true
  );
  assert.equal(commands.at(-1)?.command.endsWith("pwd"), true);
  assert.equal(commands.at(-1)?.timeoutSeconds, 12);
});
