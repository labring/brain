import { afterAll, beforeAll, mock, test } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.DEVBOX_API_BASE_URL;
const originalToken = process.env.DEVBOX_TOKEN;

beforeAll(() => {
  process.env.DEVBOX_API_BASE_URL = "https://devbox.test";
  process.env.DEVBOX_TOKEN = "test-token";
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  process.env.DEVBOX_API_BASE_URL = originalBaseUrl;
  process.env.DEVBOX_TOKEN = originalToken;
});

const { execDevbox, pauseDevbox } = await import("./client");

test("exec Devbox fetch is cancelled by the caller abort signal", async () => {
  let fetchSignal: AbortSignal | null | undefined;
  globalThis.fetch = ((_input, init) => {
    fetchSignal = init?.signal;
    return Promise.resolve(
      Response.json({
        data: { exitCode: 0, stderr: "", stdout: "done" },
      })
    );
  }) as typeof fetch;
  const controller = new AbortController();

  await execDevbox(
    "ns-test",
    "runtime",
    { command: ["bash", "-lc", "true"], timeoutSeconds: 30 },
    controller.signal
  );

  assert.equal(fetchSignal?.aborted, false);
  controller.abort();
  assert.equal(fetchSignal?.aborted, true);
});

test("an abort during Devbox network retry delay prevents another fetch", async () => {
  let fetchCalls = 0;
  const controller = new AbortController();
  globalThis.fetch = (() => {
    fetchCalls += 1;
    queueMicrotask(() => controller.abort());
    return Promise.reject(new TypeError("fetch failed"));
  }) as unknown as typeof fetch;

  await assert.rejects(
    execDevbox(
      "ns-test",
      "runtime",
      { command: ["bash", "-lc", "true"], timeoutSeconds: 30 },
      controller.signal
    ),
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError"
  );

  assert.equal(fetchCalls, 1);
});

test("pause Devbox fetch is cancelled by the caller abort signal", async () => {
  let fetchSignal: AbortSignal | null | undefined;
  globalThis.fetch = ((_input, init) => {
    fetchSignal = init?.signal;
    return Promise.resolve(Response.json({ data: {} }));
  }) as typeof fetch;
  const controller = new AbortController();

  await pauseDevbox("ns-test", "runtime", controller.signal);

  assert.equal(fetchSignal?.aborted, false);
  controller.abort();
  assert.equal(fetchSignal?.aborted, true);
});
