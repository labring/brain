import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encodeRawKubeconfig,
  headerSafeEncodedKubeconfig,
  kubeconfigBearerHeader,
  kubeconfigCredentialKey,
} from "./credential-key";

test("raw kubeconfig encoding preserves URL-sensitive and Unicode content", () => {
  const kubeconfig = "token: abc+%2B%\nname: 用户";

  assert.equal(
    encodeRawKubeconfig(kubeconfig),
    "token%3A%20abc%2B%252B%25%0Aname%3A%20%E7%94%A8%E6%88%B7"
  );
});

test("kubeconfig credential key is stable for encoded and decoded input", () => {
  const decoded = "apiVersion: v1\nclusters: []";
  const encoded = encodeURIComponent(decoded);

  assert.equal(
    kubeconfigCredentialKey(encoded),
    kubeconfigCredentialKey(decoded)
  );
  assert.equal(
    headerSafeEncodedKubeconfig(decoded),
    "apiVersion%3A%20v1%0Aclusters%3A%20%5B%5D"
  );
  assert.equal(
    kubeconfigBearerHeader(decoded),
    "Bearer apiVersion%3A%20v1%0Aclusters%3A%20%5B%5D"
  );
});

test("kubeconfig credential key does not expose raw credential material", () => {
  const kubeconfig = "apiVersion: v1\nclusters:\n- name: prod";
  const key = kubeconfigCredentialKey(kubeconfig);

  assert.notEqual(key, kubeconfig);
  assert.equal(key.includes(kubeconfig), false);
  assert.equal(key.includes("prod"), false);
  assert.notEqual(key, kubeconfigCredentialKey(`${kubeconfig}-next`));
});
