import assert from "node:assert/strict";
import { test } from "node:test";

import {
  headerSafeEncodedKubeconfig,
  kubeconfigBearerHeader,
  kubeconfigCredentialKey,
} from "./credential-key";

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
