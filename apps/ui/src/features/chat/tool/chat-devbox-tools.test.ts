import { afterAll, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

mock.module("server-only", () => ({}));
const temporary = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "devbox-tools-"))
);
const roots = new Map<string, string>();
const signals: (AbortSignal | undefined)[] = [];
const responses: string[] = [];
let calls = 0;
mock.module("../devbox/chat-runtime", () => ({
  createChatDevboxSandbox: (options: {
    namespace: string;
    kubeconfig: string;
  }) => ({
    executeCommand: async (command: string) => {
      calls += 1;
      const encoded = command.split("'")[1];
      assert.ok(encoded);
      const request = JSON.parse(Buffer.from(encoded, "base64").toString());
      request.root = roots.get(`${options.namespace}:${options.kubeconfig}`);
      assert.ok(request.root);
      const script = command.split("\n").slice(1, -1).join("\n");
      const child = spawn("python3", [
        "-I",
        "-",
        Buffer.from(JSON.stringify(request)).toString("base64"),
      ]);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data) => {
        stdout += data;
      });
      child.stderr.on("data", (data) => {
        stderr += data;
      });
      const completed = new Promise<number>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code ?? 1));
      });
      child.stdin.end(script);
      const exitCode = await completed;
      responses.push(stdout);
      return { stdout, stderr, exitCode };
    },
    runWithAbortSignal: async <T>(
      signal: AbortSignal | undefined,
      operation: () => Promise<T>
    ) => {
      signals.push(signal);
      return await operation();
    },
  }),
}));
const { createChatDevboxTools } = await import("./chat-devbox-tools");
const { CHAT_DEVBOX_WORKSPACE } = await import("./devbox-tool-input");
const intention = "verify the approved test operation";
const tools = (namespace: string, kubeconfig = "actor-a") =>
  createChatDevboxTools({ namespace, kubeconfig }).tools;
async function setup(namespace: string, actor = "actor-a") {
  const root = path.join(temporary, `${namespace}-${actor}`);
  await mkdir(root, { recursive: true });
  roots.set(`${namespace}:${actor}`, root);
  return root;
}
async function execute(
  definition: object,
  input: object,
  signal?: AbortSignal
) {
  const schema = Reflect.get(definition, "inputSchema");
  const parsed = schema.parse({ intention, ...input });
  return await Reflect.get(definition, "execute")(parsed, {
    messages: [],
    toolCallId: "call-1",
    abortSignal: signal,
  });
}
afterAll(async () => {
  await rm(temporary, { recursive: true, force: true });
});

test("real file tools preserve BOM/CRLF and reject invalid exact edits", async () => {
  const root = await setup("edits");
  const toolkit = tools("edits");
  await execute(toolkit.write, {
    path: "nested/config",
    content: "\uFEFFalpha\r\nbeta\r\n",
  });
  await execute(toolkit.edit, {
    path: "nested/config",
    edits: [{ oldText: "beta", newText: "gamma\ndelta" }],
  });
  assert.equal(
    await readFile(path.join(root, "nested/config"), "utf8"),
    "\uFEFFalpha\r\ngamma\r\ndelta\r\n"
  );
  for (const edits of [
    [{ oldText: "missing", newText: "x" }],
    [{ oldText: "a", newText: "x" }],
    [
      { oldText: "alpha", newText: "x" },
      { oldText: "lpha", newText: "y" },
    ],
  ]) {
    await assert.rejects(
      execute(toolkit.edit, { path: "nested/config", edits })
    );
  }
});

test("real file tools reject hard links, symlinks, parent links and path escapes", async () => {
  const root = await setup("links");
  const outside = path.join(temporary, "outside.txt");
  await writeFile(outside, "outside");
  await link(outside, path.join(root, "hard"));
  await symlink(outside, path.join(root, "symbolic"));
  await symlink(temporary, path.join(root, "parent"));
  const toolkit = tools("links");
  for (const target of [
    "hard",
    "symbolic",
    "parent/outside.txt",
    "parent/new-file",
    "../outside.txt",
    "/etc/passwd",
    `${CHAT_DEVBOX_WORKSPACE}-evil/file`,
  ]) {
    await assert.rejects(execute(toolkit.read, { path: target }));
    await assert.rejects(
      execute(toolkit.write, { path: target, content: "modified" })
    );
    await assert.rejects(
      execute(toolkit.edit, {
        path: target,
        edits: [{ oldText: "outside", newText: "modified" }],
      })
    );
  }
  assert.equal(await readFile(outside, "utf8"), "outside");
});

test("pagination has no phantom trailing line and bounds long UTF-8 lines", async () => {
  const root = await setup("pages");
  const toolkit = tools("pages");
  for (const content of ["", "one\ntwo", "one\ntwo\n", "\n\n"]) {
    await writeFile(path.join(root, "file"), content);
    const result = await execute(toolkit.read, { path: "file", limit: 2 });
    assert.equal(result.content, content);
    assert.equal(result.truncated, false);
    assert.equal(result.nextOffset, undefined);
  }
  await writeFile(path.join(root, "file"), "one\ntwo\nthree\n");
  assert.equal(
    (await execute(toolkit.read, { path: "file", limit: 2 })).nextOffset,
    3
  );
  assert.equal(
    (await execute(toolkit.read, { path: "file", offset: 3, limit: 2 }))
      .content,
    "three\n"
  );
  await writeFile(path.join(root, "file"), "好".repeat(30_000));
  const bounded = await execute(toolkit.read, { path: "file" });
  assert.ok(Buffer.byteLength(bounded.content) <= 50 * 1024);
  assert.equal(bounded.content.includes("�"), false);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.nextOffset, undefined);
});

test("edit refuses large inputs and enlarged results without sending file content", async () => {
  const root = await setup("large");
  const toolkit = tools("large");
  await writeFile(path.join(root, "file"), "x".repeat(2_000_000));
  await assert.rejects(
    execute(toolkit.edit, {
      path: "file",
      edits: [{ oldText: "x", newText: "y" }],
    })
  );
  assert.ok(Buffer.byteLength(responses.at(-1) ?? "") < 1000);
  await writeFile(path.join(root, "file"), `a${"b".repeat(50 * 1024 - 1)}`);
  await assert.rejects(
    execute(toolkit.edit, {
      path: "file",
      edits: [{ oldText: "a", newText: "longer" }],
    })
  );
  assert.equal((await readFile(path.join(root, "file"))).length, 50 * 1024);
});

test("bash bounds remote output, retains shell semantics and enforces timeout", async () => {
  await setup("bash");
  const toolkit = tools("bash");
  const result = await execute(toolkit.bash, {
    command:
      'python3 -c \'import sys; print("x"*2000000); print("y"*2000000,file=sys.stderr)\'',
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.stdout) <= 50 * 1024);
  assert.ok(Buffer.byteLength(result.stderr) <= 50 * 1024);
  assert.ok(Buffer.byteLength(responses.at(-1) ?? "") < 110_000);
  const normal = await execute(toolkit.bash, {
    command:
      "false\nprintf '%s' \"$BRAIN_TEST_UNSET\"\nfalse | cat\nprintf survived",
  });
  assert.equal(normal.stdout, "survived");
  assert.equal(normal.exitCode, 0);
  const timeout = await execute(toolkit.bash, {
    command: "sleep 10",
    timeoutSeconds: 1,
  });
  assert.equal(timeout.exitCode, 124);
  assert.equal(timeout.timedOut, true);
});

test("runtime lock coordinates toolsets and bash without blocking other actors", async () => {
  const root = await setup("locking");
  await setup("locking", "actor-b");
  await setup("other-namespace");
  const first = execute(tools("locking").bash, {
    command: "printf ready > started; sleep 1; printf bash > file",
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      await readFile(path.join(root, "started"));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  let finished = false;
  const same = execute(tools("locking").write, {
    path: "file",
    content: "write",
  }).then(() => {
    finished = true;
  });
  await Promise.all([
    execute(tools("locking", "actor-b").write, {
      path: "file",
      content: "independent",
    }),
    execute(tools("other-namespace").write, {
      path: "file",
      content: "independent",
    }),
  ]);
  assert.equal(finished, false);
  await Promise.all([first, same]);
  assert.equal(await readFile(path.join(root, "file"), "utf8"), "write");
});

test("schemas reject invalid inputs before exec and mutations require approval", async () => {
  const toolkit = tools("schemas");
  const before = calls;
  for (const input of [
    { path: "bad\npath", content: "x" },
    { path: "file", content: "好".repeat(20_000) },
    { path: "file", content: "x", extra: true },
  ]) {
    await assert.rejects(execute(toolkit.write, input));
  }
  for (const input of [
    { command: "x".repeat(16 * 1024 + 1) },
    { command: "好".repeat(6000) },
    { command: "true", timeoutSeconds: 61 },
    { command: "true", extra: 1 },
  ]) {
    await assert.rejects(execute(toolkit.bash, input));
  }
  for (const input of [
    { path: "file", edits: [{ oldText: "", newText: "x" }] },
    { path: "file", edits: [{ oldText: "a", newText: "b", extra: true }] },
    { path: "file", edits: [{ oldText: "a", newText: "好".repeat(20_000) }] },
  ]) {
    await assert.rejects(execute(toolkit.edit, input));
  }
  assert.equal(calls, before);
  for (const name of ["write", "edit", "bash"] as const) {
    assert.equal(toolkit[name].needsApproval, true);
  }
  assert.equal(Reflect.get(toolkit.read, "needsApproval"), undefined);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    execute(toolkit.read, { path: "file" }, controller.signal)
  );
  assert.equal(signals.at(-1), controller.signal);
  assert.equal(calls, before);
});

test("a concurrent approved bash cannot redirect queued file writes through a parent link", async () => {
  const root = await setup("parent-swap");
  const outside = path.join(temporary, "swap-outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "file"), "untouched");
  const quoted = `'${outside.replace(/'/g, "'\\''")}'`;
  const poisoning = execute(tools("parent-swap").bash, {
    command: `ln -s ${quoted} parent; printf ready > started; sleep 1`,
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      await readFile(path.join(root, "started"));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  await assert.rejects(
    execute(tools("parent-swap").write, {
      path: "parent/file",
      content: "changed",
    })
  );
  await poisoning;
  assert.equal(await readFile(path.join(outside, "file"), "utf8"), "untouched");
});
