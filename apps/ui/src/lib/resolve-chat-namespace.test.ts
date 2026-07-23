import { mock } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";

mock.module("server-only", () => ({}));
const { resolveAuthoritativeChatNamespace } = await import(
  "@/lib/resolve-chat-namespace"
);

function kubeconfig(namespace?: string): string {
  const namespaceLine =
    namespace == null ? "" : `      namespace: ${namespace}\n`;
  return encodeURIComponent(`
apiVersion: v1
clusters:
  - name: cluster
    cluster:
      server: https://example.test
contexts:
  - name: current
    context:
      cluster: cluster
${namespaceLine}      user: user
current-context: current
users:
  - name: user
    user:
      token: token
`);
}

async function withoutDevCredentialBypass<T>(
  run: () => Promise<T>
): Promise<T> {
  const previous = process.env.NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG;
  delete process.env.NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG;
    } else {
      process.env.NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG = previous;
    }
  }
}

test("normalizes the chat namespace before Kubernetes authorization", async () => {
  await withoutDevCredentialBypass(async () => {
    let verifiedNamespace = "";

    assert.deepEqual(
      await resolveAuthoritativeChatNamespace({
        clientNamespace: "  ns-sdk  ",
        encodedKubeconfig: kubeconfig("ns-sdk"),
        verify: ({ namespace }) => {
          verifiedNamespace = namespace;
          return Promise.resolve({ ok: true });
        },
      }),
      { namespace: "ns-sdk", ok: true }
    );
    assert.equal(verifiedNamespace, "ns-sdk");
  });
});

test("preserves the default namespace for a chat kubeconfig context", async () => {
  await withoutDevCredentialBypass(async () => {
    assert.deepEqual(
      await resolveAuthoritativeChatNamespace({
        clientNamespace: " default ",
        encodedKubeconfig: kubeconfig(),
        verify: async () => ({ ok: true }),
      }),
      { namespace: "default", ok: true }
    );
  });
});

test("preserves the chat namespace mismatch response before access review", async () => {
  await withoutDevCredentialBypass(async () => {
    let verified = false;

    assert.deepEqual(
      await resolveAuthoritativeChatNamespace({
        clientNamespace: "ns-other",
        encodedKubeconfig: kubeconfig("ns-sdk"),
        verify: () => {
          verified = true;
          return Promise.resolve({ ok: true });
        },
      }),
      {
        message: "namespace does not match kubeconfig current context.",
        ok: false,
        status: 403,
      }
    );
    assert.equal(verified, false);
  });
});

test("preserves a rejected chat credential response", async () => {
  await withoutDevCredentialBypass(async () => {
    assert.deepEqual(
      await resolveAuthoritativeChatNamespace({
        clientNamespace: "ns-sdk",
        encodedKubeconfig: kubeconfig("ns-sdk"),
        verify: async () => ({
          message: "Kubeconfig token is not authenticated.",
          ok: false,
          status: 401,
        }),
      }),
      {
        message: "Kubeconfig token is not authenticated.",
        ok: false,
        status: 401,
      }
    );
  });
});

test("preserves the malformed chat kubeconfig response", async () => {
  await withoutDevCredentialBypass(async () => {
    assert.deepEqual(
      await resolveAuthoritativeChatNamespace({
        clientNamespace: "ns-sdk",
        encodedKubeconfig: "%E0%A4%A",
        verify: async () => ({ ok: true }),
      }),
      {
        message: "Missing or invalid kubeconfig",
        ok: false,
        status: 400,
      }
    );
  });
});

test("preserves the unresolved namespace response for whitespace chat credentials", async () => {
  await withoutDevCredentialBypass(async () => {
    assert.deepEqual(
      await resolveAuthoritativeChatNamespace({
        clientNamespace: "ns-sdk",
        encodedKubeconfig: "   ",
        verify: async () => ({ ok: true }),
      }),
      {
        message:
          "Could not resolve namespace from kubeconfig (missing or invalid current-context).",
        ok: false,
        status: 400,
      }
    );
  });
});
