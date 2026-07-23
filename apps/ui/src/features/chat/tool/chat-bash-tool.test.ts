import { mock, test } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));

const invocationSignals: (AbortSignal | undefined)[] = [];

const sandbox = {
  executeCommand: async () => ({ exitCode: 0, stderr: "", stdout: "ok" }),
  getDevboxName: async () => "chat-runtime",
  readFile: async () => "contents",
  runWithAbortSignal: async <T>(
    signal: AbortSignal | undefined,
    operation: () => Promise<T>
  ) => {
    invocationSignals.push(signal);
    return await operation();
  },
  stop: () => Promise.resolve(),
  writeFiles: () => Promise.resolve(),
};

mock.module("../devbox/chat-runtime", () => ({
  createChatDevboxSandbox: () => sandbox,
}));

mock.module("bash-tool", () => ({
  createBashTool: ({
    sandbox: runtimeSandbox,
  }: {
    sandbox: typeof sandbox;
  }) => {
    const bash = {
      description: "bash",
      execute: async () => await runtimeSandbox.executeCommand("true"),
    };
    const readFile = {
      description: "read",
      execute: async () => ({
        content: await runtimeSandbox.readFile("/tmp/a"),
      }),
    };
    const writeFile = {
      description: "write",
      execute: async () => {
        await runtimeSandbox.writeFiles([{ content: "value", path: "/tmp/a" }]);
        return { success: true as const };
      },
    };
    return Promise.resolve({
      bash,
      sandbox: runtimeSandbox,
      tools: { bash, readFile, writeFile },
    });
  },
}));

const { createChatBashTool } = await import("./chat-bash-tool");

test("chat bash tool wrappers forward the AI SDK abort signal to the sandbox", async () => {
  invocationSignals.length = 0;
  const controller = new AbortController();
  const toolkit = await createChatBashTool({
    kubeconfig: "apiVersion: v1",
    namespace: "ns-test",
  });
  const executionOptions = {
    abortSignal: controller.signal,
    messages: [],
    toolCallId: "call-1",
  };

  await Reflect.get(toolkit.tools.bash, "execute")(
    { command: "true", intention: "test cancellation" },
    executionOptions
  );
  await Reflect.get(toolkit.tools.readFile, "execute")(
    { intention: "test cancellation", path: "a" },
    executionOptions
  );
  await Reflect.get(toolkit.tools.writeFile, "execute")(
    { content: "value", intention: "test cancellation", path: "a" },
    executionOptions
  );

  assert.deepEqual(invocationSignals, [
    controller.signal,
    controller.signal,
    controller.signal,
  ]);
});
