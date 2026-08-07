import assert from "node:assert/strict";
import { test } from "node:test";

import {
  judgeOnboardingSampling,
  ONBOARDING_GATE_RETRY_DELAYS_MS,
  obtainOnboardingSessionJudgment,
  onboardingCredentialsKey,
  onboardingCredentialsReady,
  resetOnboardingGateSessionForTesting,
} from "./onboarding-gate-core";

test("the gate does nothing until every credential has hydrated", () => {
  const ready = { appToken: "token", kubeconfig: "kc", namespace: "ns-user" };
  assert.equal(onboardingCredentialsReady(ready), true);
  assert.equal(onboardingCredentialsReady({ ...ready, appToken: " " }), false);
  assert.equal(onboardingCredentialsReady({ ...ready, kubeconfig: "" }), false);
  assert.equal(onboardingCredentialsReady({ ...ready, namespace: "" }), false);
});

test("remounts under the same credential identity reuse the one judgment", () => {
  resetOnboardingGateSessionForTesting();
  const key = onboardingCredentialsKey({
    appToken: "token-a",
    kubeconfig: "kc-a",
    namespace: "ns-a",
  });
  let judged = 0;
  const judge = () => {
    judged += 1;
    return Promise.resolve(true);
  };

  const first = obtainOnboardingSessionJudgment({ judge, key });
  const second = obtainOnboardingSessionJudgment({ judge, key });

  assert.equal(judged, 1);
  assert.equal(first.promise, second.promise);
  assert.equal(first.rekeyed, false);
  assert.equal(second.rekeyed, false);
  resetOnboardingGateSessionForTesting();
});

test("a mid-session credential change discards the old judgment and re-judges", () => {
  resetOnboardingGateSessionForTesting();
  const credentials = {
    appToken: "token-a",
    kubeconfig: "kc-a",
    namespace: "ns-a",
  };
  let judged = 0;
  const judge = () => {
    judged += 1;
    return Promise.resolve(true);
  };

  const first = obtainOnboardingSessionJudgment({
    judge,
    key: onboardingCredentialsKey(credentials),
  });
  const swapped = obtainOnboardingSessionJudgment({
    judge,
    key: onboardingCredentialsKey({ ...credentials, appToken: "token-b" }),
  });

  assert.equal(judged, 2);
  assert.notEqual(first.promise, swapped.promise);
  assert.equal(swapped.rekeyed, true, "the identity swap is reported");
  resetOnboardingGateSessionForTesting();
});

test("the credential fingerprint separates fields unambiguously", () => {
  // A field boundary shift ("a b" + "c" vs "a" + "b c") must not collide.
  const one = onboardingCredentialsKey({
    appToken: "t",
    kubeconfig: "a b",
    namespace: "c",
  });
  const other = onboardingCredentialsKey({
    appToken: "t",
    kubeconfig: "a",
    namespace: "b c",
  });
  assert.notEqual(one, other);
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

test("an authorization refusal fails closed without retries", async () => {
  const delays: number[] = [];
  let attempts = 0;
  const opened = await judgeOnboardingSampling({
    delay: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    fetchVerdict: () => {
      attempts += 1;
      return Promise.resolve("unauthorized" as const);
    },
  });

  assert.equal(opened, false);
  assert.equal(attempts, 1);
  assert.deepEqual(delays, []);
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
