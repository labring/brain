import assert from "node:assert/strict";
import { test } from "node:test";

import {
  judgeOnboardingSampling,
  ONBOARDING_GATE_RETRY_DELAYS_MS,
  onboardingCredentialsReady,
} from "./onboarding-gate-core";

test("the gate does nothing until every credential has hydrated", () => {
  const ready = { appToken: "token", kubeconfig: "kc", namespace: "ns-user" };
  assert.equal(onboardingCredentialsReady(ready), true);
  assert.equal(onboardingCredentialsReady({ ...ready, appToken: " " }), false);
  assert.equal(onboardingCredentialsReady({ ...ready, kubeconfig: "" }), false);
  assert.equal(onboardingCredentialsReady({ ...ready, namespace: "" }), false);
});

test("only a definitive Unsampled verdict opens the dialog", async () => {
  assert.equal(
    await judgeOnboardingSampling({
      fetchVerdict: () => Promise.resolve({ sampled: false }),
    }),
    true
  );
  assert.equal(
    await judgeOnboardingSampling({
      fetchVerdict: () => Promise.resolve({ sampled: true }),
    }),
    false
  );
});

test("failures retry on the backoff schedule before a verdict lands", async () => {
  const delays: number[] = [];
  let attempts = 0;
  const opened = await judgeOnboardingSampling({
    delay: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    fetchVerdict: () => {
      attempts += 1;
      return attempts < 3
        ? Promise.resolve(null)
        : Promise.resolve({ sampled: false });
    },
  });

  assert.equal(opened, true);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [...ONBOARDING_GATE_RETRY_DELAYS_MS]);
});

test("after two failed retries the gate silently stands down", async () => {
  let attempts = 0;
  const opened = await judgeOnboardingSampling({
    delay: () => Promise.resolve(),
    fetchVerdict: () => {
      attempts += 1;
      return Promise.reject(new Error("network down"));
    },
  });

  assert.equal(opened, false);
  assert.equal(attempts, 1 + ONBOARDING_GATE_RETRY_DELAYS_MS.length);
});
