import { mock, test } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
mock.module("./lifecycle-registration", () => ({
  recordChatDevboxActivity: () => Promise.resolve(),
}));

const {
  bootstrapChatDevboxIfNeeded,
  getChatDevboxSkillsSnapshot,
  warmChatDevboxSkills,
} = await import("./chat-runtime");

test("Skill snapshots are empty before background warmup without starting a Devbox", () => {
  assert.deepEqual(
    getChatDevboxSkillsSnapshot({
      kubeconfig: "apiVersion: v1",
      namespace: "ns-test",
    }),
    []
  );
});

test("background Skill warmup is shared and publishes metadata after discovery", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.DEVBOX_API_BASE_URL;
  const originalToken = process.env.DEVBOX_TOKEN;
  let execCalls = 0;
  let installCommand = "";
  let emptyDiscovery = false;
  let preparationFails = false;
  let prepareCalls = 0;
  let creationTimestamp: string | null = "2026-09-07T00:00:00Z";
  let discoveryGate: Promise<void> | undefined;
  let onDiscovery: (() => void) | undefined;
  const upstreamIds: string[] = [];
  const originalImage = process.env.DEVBOX_RUNTIME_IMAGE;

  process.env.DEVBOX_API_BASE_URL = "https://devbox.test";
  process.env.DEVBOX_TOKEN = "test-token";
  globalThis.fetch = ((
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const url = new URL(String(input));
    if (url.searchParams.has("upstreamID")) {
      upstreamIds.push(url.searchParams.get("upstreamID") ?? "");
      return Response.json({
        data: { items: [{ name: "existing-runtime" }] },
      });
    }
    if (url.pathname.endsWith("/pause/refresh")) {
      return Response.json({ data: {} });
    }
    if (url.pathname.endsWith("/existing-runtime")) {
      return Response.json({
        data: { creationTimestamp, state: { phase: "Running" } },
      });
    }
    if (url.pathname.endsWith("/exec")) {
      execCalls += 1;
      const body = JSON.parse(String(init?.body)) as {
        command?: string[];
      };
      const command = body.command?.at(-1) ?? "";
      if (command.includes("sealai-prepare-skills")) {
        prepareCalls += 1;
        installCommand = command;
        if (preparationFails) {
          return Response.json({
            data: { exitCode: 1, stderr: "private raw error", stdout: "" },
          });
        }
      }
      if (command.includes("find ")) {
        onDiscovery?.();
        const response = Response.json({
          data: {
            exitCode: 0,
            stderr: "",
            stdout: emptyDiscovery
              ? ""
              : "/home/devbox/project/.agents/skills/sealos-deploy/SKILL.md\n",
          },
        });
        return discoveryGate == null
          ? response
          : discoveryGate.then(() => response);
      }
      if (command.includes("cat --")) {
        return Response.json({
          data: {
            exitCode: 0,
            stderr: "",
            stdout:
              "---\nname: sealos-deploy\ndescription: Deploy apps.\n---\n# Deploy",
          },
        });
      }
      return Response.json({
        data: { exitCode: 0, stderr: "", stdout: "" },
      });
    }
    throw new Error(`Unexpected Devbox request: ${url.pathname}`);
  }) as unknown as typeof fetch;

  try {
    const options = {
      kubeconfig: "apiVersion: v1",
      namespace: "ns-warmup",
    };
    const firstWarmup = warmChatDevboxSkills(options);
    const secondWarmup = warmChatDevboxSkills(options);
    assert.strictEqual(firstWarmup, secondWarmup);
    await firstWarmup;

    assert.deepEqual(
      getChatDevboxSkillsSnapshot(options).map((skill) => skill.name),
      ["sealos-deploy"]
    );
    assert.ok(execCalls >= 3);
    assert.ok(installCommand.includes("/usr/local/bin/sealai-prepare-skills"));
    assert.ok(!installCommand.includes("npx"));
    assert.ok(installCommand.includes(" --init-workspace"));
    const warmedExecCalls = execCalls;
    await warmChatDevboxSkills(options);
    assert.equal(execCalls, warmedExecCalls);
    const copiedSnapshot = await warmChatDevboxSkills(options);
    assert.ok(copiedSnapshot[0]);
    copiedSnapshot[0].name = "modified-by-caller";
    assert.equal(
      (await warmChatDevboxSkills(options))[0]?.name,
      "sealos-deploy"
    );
    const failureOptions = { ...options, namespace: "ns-warmup-failure" };
    emptyDiscovery = true;
    await assert.rejects(warmChatDevboxSkills(failureOptions));
    emptyDiscovery = false;
    creationTimestamp = "2026-09-07T01:00:00Z";
    preparationFails = true;
    await assert.rejects(
      warmChatDevboxSkills(failureOptions),
      (error: unknown) =>
        error instanceof Error && !error.message.includes("private raw error")
    );
    preparationFails = false;
    assert.equal(
      (await warmChatDevboxSkills(failureOptions))[0]?.name,
      "sealos-deploy"
    );
    const previousIdentity = upstreamIds.at(-1);
    process.env.DEVBOX_RUNTIME_IMAGE =
      "example.test/sandbox@sha256:new-test-image";
    assert.deepEqual(getChatDevboxSkillsSnapshot(options), []);
    await warmChatDevboxSkills(options);
    assert.notEqual(upstreamIds.at(-1), previousIdentity);

    const { buildChatToolset } = await import("../runtime/tools");
    const toolsetOptions = {
      chatId: "skills-first-turn",
      kubeconfig: options.kubeconfig,
      kubernetesNamespace: "ns-toolset-first-turn",
      workspaceActor: "test-actor",
      workspaceUserUid: "test-user",
    };
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    discoveryGate = gate.promise;
    onDiscovery = started.resolve;
    let toolsetReady = false;
    const toolset = buildChatToolset(toolsetOptions).then((result) => {
      toolsetReady = true;
      return result;
    });
    await started.promise;
    assert.equal(toolsetReady, false);
    gate.resolve();
    const ready = await toolset;
    assert.ok(ready.systemPrompt.includes("sealos-deploy"));
    assert.ok(ready.tools.loadSkill);
    const firstTurnExecCalls = execCalls;
    const secondTurn = await buildChatToolset(toolsetOptions);
    assert.equal(execCalls, firstTurnExecCalls);
    const prepared = prepareCalls;
    const loadSkill = secondTurn.tools.loadSkill?.execute;
    assert.ok(loadSkill);
    await loadSkill(
      { name: "sealos-deploy", intention: "Deploy an app" },
      { toolCallId: "load-skill", messages: [], context: undefined }
    );
    assert.equal(prepareCalls, prepared);
    creationTimestamp = "2026-09-07T02:00:00Z";
    await bootstrapChatDevboxIfNeeded({
      kubeconfig: options.kubeconfig,
      namespace: toolsetOptions.kubernetesNamespace,
    });
    assert.equal(prepareCalls, prepared + 1);
    creationTimestamp = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await bootstrapChatDevboxIfNeeded({
        kubeconfig: options.kubeconfig,
        namespace: toolsetOptions.kubernetesNamespace,
      });
    }
    assert.equal(prepareCalls, prepared + 3);
  } finally {
    if (originalImage === undefined) {
      delete process.env.DEVBOX_RUNTIME_IMAGE;
    } else {
      process.env.DEVBOX_RUNTIME_IMAGE = originalImage;
    }
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.DEVBOX_API_BASE_URL;
    } else {
      process.env.DEVBOX_API_BASE_URL = originalBaseUrl;
    }
    if (originalToken === undefined) {
      delete process.env.DEVBOX_TOKEN;
    } else {
      process.env.DEVBOX_TOKEN = originalToken;
    }
  }
});

test("Devbox readiness polling stops while sleeping when the tool call aborts", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.DEVBOX_API_BASE_URL;
  const originalToken = process.env.DEVBOX_TOKEN;
  const controller = new AbortController();
  let getCalls = 0;

  process.env.DEVBOX_API_BASE_URL = "https://devbox.test";
  process.env.DEVBOX_TOKEN = "test-token";
  globalThis.fetch = ((input) => {
    const url = new URL(String(input));
    if (url.searchParams.has("upstreamID")) {
      return Promise.resolve(
        Response.json({ data: { items: [{ name: "existing-runtime" }] } })
      );
    }

    getCalls += 1;
    queueMicrotask(() => controller.abort());
    return Promise.resolve(
      Response.json(
        { message: "get devbox private key failed: secret not found" },
        { status: 500 }
      )
    );
  }) as typeof fetch;

  try {
    await assert.rejects(
      bootstrapChatDevboxIfNeeded(
        { kubeconfig: "apiVersion: v1", namespace: "ns-test" },
        controller.signal
      ),
      (error: unknown) =>
        error instanceof DOMException && error.name === "AbortError"
    );
    assert.equal(getCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.DEVBOX_API_BASE_URL;
    } else {
      process.env.DEVBOX_API_BASE_URL = originalBaseUrl;
    }
    if (originalToken === undefined) {
      delete process.env.DEVBOX_TOKEN;
    } else {
      process.env.DEVBOX_TOKEN = originalToken;
    }
  }
});
