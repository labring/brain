import { describe, expect, it, mock } from "bun:test";

import type { WorkspaceBillingStanding } from "@/features/billing/server/billing-standing-core";

mock.module("server-only", () => ({}));
const { judgeChatBilling, resolveFreeTierPosture } = await import(
  "./chat-billing-judgment"
);

const OPEN_PAYG: WorkspaceBillingStanding = {
  accountDebt: false,
  aiCredits: null,
  availableBalanceMicroUnits: 50_000_000,
  fullQuota: null,
  paidSource: "balance",
  quotaKnown: true,
};

const ACTOR = {
  accountUserId: "user-1",
  cookieHeader: null,
  namespace: "ns-test",
  userUid: "uid-1",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("judgeChatBilling", () => {
  it("starts the standing reads before the trial judgment and hands both the same budget", async () => {
    // ADR-0068: one budget, in parallel — never one 5 s timeout after another.
    const order: string[] = [];
    const signals: (AbortSignal | undefined)[] = [];
    const standing = deferred<WorkspaceBillingStanding>();
    const trial = deferred<"trial">();

    const judging = judgeChatBilling(ACTOR, {
      isSystemOpenAiConfigured: () => true,
      judgeActiveFreeTrialForWorkspace: (input) => {
        order.push("trial");
        signals.push(input.signal);
        return trial.promise;
      },
      judgeWorkspaceBillingStandingForActor: (input) => {
        order.push("standing");
        signals.push(input.signal);
        return standing.promise;
      },
      readFreeTierSnapshot: () =>
        Promise.resolve({ limit: 5, remaining: 5, used: 0 }),
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["standing", "trial"]);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBe(signals[0]);

    trial.resolve("trial");
    const judgment = await judging;
    expect(judgment.trial).toBe("trial");
    standing.resolve({ ...OPEN_PAYG, accountDebt: true });
    expect(await judgment.paidWall()).toEqual({
      paidSource: "balance",
      wall: "balance",
    });
  });

  it("skips the trial judgment when only `user` is possible, still reading the standing", async () => {
    let trialCalls = 0;
    const judgment = await judgeChatBilling(ACTOR, {
      isSystemOpenAiConfigured: () => true,
      judgeActiveFreeTrialForWorkspace: () => {
        trialCalls += 1;
        return Promise.resolve("trial");
      },
      judgeWorkspaceBillingStandingForActor: () => Promise.resolve(OPEN_PAYG),
      readFreeTierSnapshot: () =>
        Promise.resolve({ limit: 0, remaining: 0, used: 0 }),
    });
    expect(trialCalls).toBe(0);
    expect(judgment.trial).toBe("not-trial");
    expect(await judgment.paidWall()).toEqual({
      paidSource: "balance",
      wall: null,
    });
  });

  it("fails open when the standing read rejects", async () => {
    const judgment = await judgeChatBilling(ACTOR, {
      isSystemOpenAiConfigured: () => true,
      judgeActiveFreeTrialForWorkspace: () => Promise.resolve("not-trial"),
      judgeWorkspaceBillingStandingForActor: () =>
        Promise.reject(new Error("upstream down")),
      readFreeTierSnapshot: () =>
        Promise.resolve({ limit: 5, remaining: 5, used: 0 }),
    });
    expect(await judgment.paidWall()).toEqual({
      paidSource: null,
      wall: null,
    });
  });
});

describe("resolveFreeTierPosture", () => {
  it("walls only a `user` posture; a free posture ignores the standing it read", async () => {
    const walled = { ...OPEN_PAYG, accountDebt: true };
    const free = await resolveFreeTierPosture(ACTOR, {
      isSystemOpenAiConfigured: () => true,
      judgeActiveFreeTrialForWorkspace: () => Promise.resolve("trial"),
      judgeWorkspaceBillingStandingForActor: () => Promise.resolve(walled),
      readFreeTierSnapshot: () =>
        Promise.resolve({ limit: 5, remaining: 2, used: 3 }),
    });
    expect(free).toEqual({ billing: "free", limit: 5, remaining: 2 });

    const user = await resolveFreeTierPosture(ACTOR, {
      isSystemOpenAiConfigured: () => true,
      judgeActiveFreeTrialForWorkspace: () => Promise.resolve("not-trial"),
      judgeWorkspaceBillingStandingForActor: () => Promise.resolve(walled),
      readFreeTierSnapshot: () =>
        Promise.resolve({ limit: 5, remaining: 2, used: 3 }),
    });
    expect(user).toEqual({
      billing: "user",
      limit: 5,
      paidSource: "balance",
      remaining: 2,
      wall: "balance",
    });
  });
});
