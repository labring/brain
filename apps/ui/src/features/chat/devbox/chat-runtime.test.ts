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

  process.env.DEVBOX_API_BASE_URL = "https://devbox.test";
  process.env.DEVBOX_TOKEN = "test-token";
  globalThis.fetch = ((
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const url = new URL(String(input));
    if (url.searchParams.has("upstreamID")) {
      return Response.json({
        data: { items: [{ name: "existing-runtime" }] },
      });
    }
    if (url.pathname.endsWith("/pause/refresh")) {
      return Response.json({ data: {} });
    }
    if (url.pathname.endsWith("/existing-runtime")) {
      return Response.json({
        data: { state: { phase: "Running" } },
      });
    }
    if (url.pathname.endsWith("/exec")) {
      execCalls += 1;
      const body = JSON.parse(String(init?.body)) as {
        command?: string[];
      };
      const command = body.command?.at(-1) ?? "";
      if (command.includes("find ")) {
        return Response.json({
          data: {
            exitCode: 0,
            stderr: "",
            stdout:
              "/home/devbox/project/.agents/skills/sealos-deploy/SKILL.md\n",
          },
        });
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
