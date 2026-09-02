import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render, within } from "@testing-library/react/pure";
import { createStore, Provider } from "jotai";
import { SWRConfig } from "swr";

import {
  defineGlobal,
  jsonResponse,
  requestUrl,
  restoreGlobal,
  withTestDom,
} from "@/features/project-canvas/react-test-harness";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";
import { formatBillingDate, formatBillingDateTime } from "./billing-datetime";
import type { BillingPlanSnapshot } from "./billing-plan-data";

const SNAPSHOT: BillingPlanSnapshot = {
  availability: {
    card: "available",
    transaction: "available",
    workspaces: "available",
  },
  card: { brand: "visa", last4: "4242" },
  current: {
    canManage: true,
    cancelAtPeriodEnd: false,
    currentPeriodEndAt: "2026-08-31T00:00:00Z",
    invoiceId: null,
    invoicePaymentUrl: null,
    isActiveFreeTrial: false,
    isPayg: false,
    lifecycle: "active",
    payMethod: "stripe",
    periodEndVoice: "renewal",
    planName: "Pro",
    priceMicroUnits: 20_000_000,
    recoveryVoice: "renew",
    regionDomain: "us.example.test",
    resources: [{ label: "CPU", value: "4" }],
    warningDeadlineAt: null,
    warningStage: null,
    workspace: "workspace-a",
  },
  pendingDowngrade: null,
  pendingUpgrade: null,
  plans: [
    {
      changeKind: null,
      description: "For growing workloads",
      id: "pro",
      isCurrent: true,
      limits: { cpu: "4" },
      name: "Pro",
      order: 2,
      priceMicroUnits: 20_000_000,
      resources: [{ label: "CPU", value: "4" }],
    },
    {
      changeKind: "upgrade",
      description: "For larger teams",
      id: "team",
      isCurrent: false,
      limits: { cpu: "12" },
      name: "Team",
      order: 3,
      priceMicroUnits: 50_000_000,
      resources: [{ label: "CPU", value: "12" }],
    },
  ],
  workspaces: [],
};

test("upgrade mode opens the plan workflow and is consumed from the URL", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanWorkflow } = await import("./billing-plan");
    const replacements: string[] = [];
    let rendered: ReturnType<typeof render> | undefined;

    window.history.replaceState({}, "", "/billing?mode=upgrade&source=quota");

    try {
      await act(() => {
        rendered = render(
          <BillingPlanWorkflow
            balance={<span>$3.00</span>}
            credentials={{
              appToken: "desktop-app-token",
              kubeconfig: "apiVersion: v1",
            }}
            currency="usd"
            gpuEnabled
            initialMode="upgrade"
            onRefreshSnapshot={() => Promise.resolve(SNAPSHOT)}
            replaceUrl={(url) => replacements.push(url)}
            snapshot={SNAPSHOT}
          />
        );
      });

      assert.ok(
        rendered?.getByRole("dialog", {
          name: "Choose Your Workspace Plan",
        })
      );
      assert.deepEqual(replacements, ["/billing?source=quota"]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("upgrade mode is consumed without a dialog when billing actions are locked", async () => {
  // A deep link must not open a picker whose cards carry no actions
  // (AIM-252's secondary finding): the unavailable lifecycle keeps the user
  // on the Plan view, where the status notice explains the lock.
  await withTestDom(async (act) => {
    const { BillingPlanWorkflow } = await import("./billing-plan");
    const replacements: string[] = [];
    let rendered: ReturnType<typeof render> | undefined;

    window.history.replaceState({}, "", "/billing?mode=upgrade&source=quota");

    const snapshot: BillingPlanSnapshot = {
      ...SNAPSHOT,
      current: { ...SNAPSHOT.current, lifecycle: "unavailable" },
    };

    try {
      await act(() => {
        rendered = render(
          <BillingPlanWorkflow
            balance={<span>$3.00</span>}
            credentials={{
              appToken: "desktop-app-token",
              kubeconfig: "apiVersion: v1",
            }}
            currency="usd"
            gpuEnabled
            initialMode="upgrade"
            onRefreshSnapshot={() => Promise.resolve(snapshot)}
            replaceUrl={(url) => replacements.push(url)}
            snapshot={snapshot}
          />
        );
      });

      assert.equal(
        rendered?.queryByRole("dialog", {
          name: "Choose Your Workspace Plan",
        }),
        null
      );
      assert.deepEqual(replacements, ["/billing?source=quota"]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("Free payment-due renewal opens the paid plan picker", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanWorkflow } = await import("./billing-plan");
    const snapshot: BillingPlanSnapshot = {
      ...SNAPSHOT,
      current: {
        ...SNAPSHOT.current,
        currentPeriodEndAt: "2026-07-08T02:49:00Z",
        lifecycle: "payment-due",
        planName: "Free",
        priceMicroUnits: 0,
        warningDeadlineAt: "2026-07-22T02:49:00Z",
        warningStage: "expired",
      },
      plans: [
        {
          changeKind: null,
          description: "Free workspace plan",
          hasMonthlyPrice: false,
          id: "free",
          isCurrent: true,
          limits: { cpu: "4" },
          name: "Free",
          order: 0,
          priceMicroUnits: 0,
          resources: [{ label: "CPU", value: "4" }],
          tags: ["more"],
        },
        ...SNAPSHOT.plans.map((plan) => ({
          ...plan,
          changeKind: "upgrade" as const,
          isCurrent: false,
        })),
      ],
    };
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await act(() => {
        rendered = render(
          <BillingPlanWorkflow
            balance={<span>$3.00</span>}
            credentials={{
              appToken: "desktop-app-token",
              kubeconfig: "apiVersion: v1",
            }}
            currency="usd"
            gpuEnabled
            onRefreshSnapshot={() => Promise.resolve(snapshot)}
            replaceUrl={() => undefined}
            snapshot={snapshot}
          />
        );
      });

      assert.equal(rendered?.queryByRole("dialog"), null);
      await act(() => {
        const renew = rendered?.getByRole("button", { name: "Renew" });
        if (renew != null) {
          fireEvent.click(renew);
        }
      });

      const dialog = rendered?.getByRole("dialog", {
        name: "Choose Your Workspace Plan",
      });
      assert.ok(dialog?.textContent?.includes("Pro"));
      assert.equal(dialog?.textContent?.includes("Free"), false);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("Stripe return refreshes before congratulations and clears on close", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanWorkflow } = await import("./billing-plan");
    const replacements: string[] = [];
    const events: string[] = [];
    const refreshedSnapshot: BillingPlanSnapshot = {
      ...SNAPSHOT,
      current: {
        ...SNAPSHOT.current,
        planName: "Team",
        priceMicroUnits: 50_000_000,
        resources: [{ label: "CPU", value: "12" }],
      },
    };
    let rendered: ReturnType<typeof render> | undefined;

    window.history.replaceState(
      {},
      "",
      "/billing?stripeState=success&payId=payment-1&workspaceId=workspace-a&source=stripe"
    );

    try {
      await act(() => {
        rendered = render(
          <BillingPlanWorkflow
            balance={<span>$3.00</span>}
            credentials={{
              appToken: "desktop-app-token",
              kubeconfig: "apiVersion: v1",
            }}
            currency="usd"
            gpuEnabled
            onRefreshSnapshot={(workspaceId) => {
              events.push(`refresh:${workspaceId}`);
              return Promise.resolve(refreshedSnapshot);
            }}
            replaceUrl={(url) => replacements.push(url)}
            snapshot={SNAPSHOT}
            stripeReturn={{
              payId: "payment-1",
              workspaceId: "workspace-a",
            }}
          />
        );
      });

      assert.deepEqual(events, ["refresh:workspace-a"]);
      // The redirect leg concludes in the same dialog as the polling leg —
      // the plan is the subject, and it returns without a prorated charge.
      assert.ok(rendered?.getByRole("dialog", { name: "Team" }));
      const congratulations = rendered?.baseElement.textContent ?? "";
      assert.ok(congratulations.includes("workspace-a"));
      assert.ok(congratulations.includes("12"));
      assert.ok(congratulations.includes("CPU"));
      assert.ok(
        congratulations.includes(
          `Billed monthly from ${formatBillingDate("2026-08-31T00:00:00Z")}`
        )
      );
      assert.ok(congratulations.includes("$50.00"));
      assert.equal(congratulations.includes("Charged today"), false);
      assert.deepEqual(replacements, []);

      await act(() => {
        const done = rendered?.getByRole("button", { name: "Done" });
        if (done != null) {
          fireEvent.click(done);
        }
      });

      assert.deepEqual(replacements, ["/billing?source=stripe"]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("a settled poll closes the checkout and picker into congratulations", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanWorkflow } = await import("./billing-plan");
    const scheduled: Array<() => void> = [];
    const refreshedSnapshot: BillingPlanSnapshot = {
      ...SNAPSHOT,
      current: {
        ...SNAPSHOT.current,
        planName: "Team",
        priceMicroUnits: 50_000_000,
        resources: [{ label: "CPU", value: "12" }],
      },
    };
    let rendered: ReturnType<typeof render> | undefined;

    window.history.replaceState({}, "", "/billing?mode=upgrade");

    try {
      await act(() => {
        rendered = render(
          <BillingPlanWorkflow
            balance={<span>$3.00</span>}
            checkoutServices={{
              cancelInvoice: () => Promise.resolve(),
              checkDowngrade: () =>
                Promise.resolve({ allowed: true, exceededResources: [] }),
              createPayment: () =>
                Promise.resolve({
                  invoiceId: "invoice-1",
                  payId: "payment-1",
                  redirectUrl: "https://checkout.stripe.test/invoice-1",
                  success: true,
                }),
              loadTransaction: () =>
                Promise.resolve({
                  id: "transaction-1",
                  operator: "upgraded",
                  payId: "payment-1",
                  planName: "Team",
                  status: "completed",
                  startAt: null,
                }),
              loadUpgradeQuote: () =>
                Promise.resolve({
                  kind: "quote" as const,
                  quote: {
                    amountMicroUnits: 31_694_000,
                    discountMicroUnits: 0,
                    hasDiscount: false,
                    originalAmountMicroUnits: 31_694_000,
                    promotionCode: "",
                  },
                }),
              openCheckoutUrl: () => undefined,
              openCheckoutWindow: () => ({
                close: () => undefined,
                navigate: () => undefined,
              }),
              redirectTop: () => undefined,
            }}
            credentials={{
              appToken: "desktop-app-token",
              kubeconfig: "apiVersion: v1",
            }}
            currency="usd"
            gpuEnabled
            initialMode="upgrade"
            onRefreshSnapshot={() => Promise.resolve(refreshedSnapshot)}
            replaceUrl={() => undefined}
            schedulePoll={(run) => {
              scheduled.push(run);
              return () => undefined;
            }}
            snapshot={SNAPSHOT}
          />
        );
      });

      await act(() => {
        const upgrade = rendered?.getByRole("button", { name: "Upgrade" });
        if (upgrade != null) {
          fireEvent.click(upgrade);
        }
      });
      await act(() => {
        const confirm = rendered?.getByRole("button", {
          name: "Subscribe & Pay",
        });
        if (confirm != null) {
          fireEvent.click(confirm);
        }
      });

      assert.ok(
        (rendered?.baseElement.textContent ?? "").includes("Payment successful")
      );
      await act(() => scheduled.at(-1)?.());

      // Both the checkout and the picker beneath it have gone, and the
      // conclusion carries the refreshed plan plus what was charged today.
      assert.equal(
        rendered?.queryByRole("dialog", {
          name: "Choose Your Workspace Plan",
        }),
        null
      );
      assert.ok(rendered?.getByRole("dialog", { name: "Team" }));
      const congratulations = rendered?.baseElement.textContent ?? "";
      assert.ok(congratulations.includes("workspace-a"));
      assert.ok(congratulations.includes("12"));
      assert.ok(congratulations.includes("Charged today"));
      assert.ok(congratulations.includes("$31.69"));
      assert.ok(
        congratulations.includes(
          `Billed monthly from ${formatBillingDate("2026-08-31T00:00:00Z")}`
        )
      );
      assert.ok(congratulations.includes("$50.00"));

      await act(() => {
        const done = rendered?.getByRole("button", { name: "Done" });
        if (done != null) {
          fireEvent.click(done);
        }
      });
      assert.equal(rendered?.queryByRole("dialog", { name: "Team" }), null);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

const PLAN_PAGE_RESPONSES: Record<string, unknown> = {
  "/api/billing/account": {
    account: { Balance: 4_200_000, DeductionBalance: 1_200_000 },
  },
  // A paid plan's own grant: the aggregate feeds the available total while
  // the zero KYC pair keeps the Gift chip away.
  "/api/billing/credits": {
    credits: {
      credits: 3_000_000,
      currentPlanCreditsBalance: 3_000_000,
      currentPlanCreditsDeductionBalance: 1_200_000,
      deductionCredits: 1_200_000,
      kycDeductionCreditsBalance: 0,
      kycDeductionCreditsDeductionBalance: 0,
    },
  },
  "/api/billing/card": {
    payment_method: {
      card: { brand: "visa", exp_month: 12, exp_year: 2028, last4: "4242" },
    },
    success: true,
  },
  "/api/billing/plans": {
    plans: [
      {
        AIQuota: 20_000_000,
        Description: "For growing workloads",
        ID: "plan-pro",
        MaxResources: JSON.stringify({ cpu: "4", memory: "8Gi" }),
        Name: "Pro",
        Order: 2,
        Prices: [{ BillingCycle: "1m", Price: 20_000_000 }],
        Tags: [],
        Traffic: 4096,
      },
    ],
  },
  "/api/billing/regions": {
    current: { domain: "us.example.test", uid: "region-us" },
  },
  "/api/billing/subscription": {
    subscription: {
      CancelAtPeriodEnd: false,
      CurrentPeriodEndAt: "2026-08-31T00:00:00Z",
      ExpireAt: "2026-08-31T00:00:00Z",
      PayMethod: "stripe",
      PlanName: "Pro",
      RegionDomain: "us.example.test",
      Status: "Normal",
      Workspace: "workspace-a",
      role: "OWNER",
      type: "SUBSCRIPTION",
    },
  },
  "/api/billing/subscription/last-transaction": {},
  "/api/billing/subscriptions": { subscriptions: [] },
  "/api/billing/workspace-quota": {
    quota: {
      hard: { ai_quota: 20_000_000 },
      used: { ai_quota: 12_000_000 },
    },
  },
  "/api/billing/workspaces": {
    data: [["workspace-a", "Workspace Alpha"]],
  },
};

const USED_TOTAL_RE = /1,200\s*\/\s*2,000/;
const UNUSED_TOTAL_RE = /0\s*\/\s*2,000/;
const OVERSHOOT_TOTAL_RE = /2,500\s*\/\s*2,000/;
const RESETS_LABEL_RE = /Resets:/;

function assertTextOrder(text: string, labels: readonly string[]) {
  let previousIndex = -1;
  for (const label of labels) {
    const index = text.indexOf(label);
    assert.ok(index > previousIndex, `${label} follows the preceding section`);
    previousIndex = index;
  }
}

function planPageResponses(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...PLAN_PAGE_RESPONSES, ...overrides };
}

async function renderPlanPage(
  act: Parameters<Parameters<typeof withTestDom>[0]>[0],
  respond: (
    pathname: string,
    init?: RequestInit
  ) => Response | Promise<Response>
) {
  const override = defineGlobal(
    "fetch",
    (input: unknown, init?: RequestInit) => {
      const pathname = new URL(requestUrl(input), "https://brain.example.test")
        .pathname;
      return Promise.resolve(respond(pathname, init));
    }
  );
  const { BillingPlan } = await import("./billing-plan");
  const store = createStore();
  store.set(appTokenAtom, "desktop-app-token");
  store.set(kubeconfigAtom, "apiVersion: v1");
  store.set(namespaceAtom, "workspace-a");
  let rendered: ReturnType<typeof render> | undefined;
  await act(() => {
    rendered = render(
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
        <Provider store={store}>
          <BillingPlan currency="usd" gpuEnabled replaceUrl={() => undefined} />
        </Provider>
      </SWRConfig>
    );
  });
  return {
    rendered,
    restore: async () => {
      restoreGlobal(override);
      await act(() => rendered?.unmount());
    },
  };
}

function jsonFixtureResponse(
  responses: Record<string, unknown>,
  pathname: string
): Response {
  const response = responses[pathname];
  assert.notEqual(response, undefined, `fixture exists for ${pathname}`);
  return jsonResponse(response);
}

test("subscription Plan shows converted AI Credits used, total, bar, and reset date", async () => {
  await withTestDom(async (act) => {
    const { rendered, restore } = await renderPlanPage(act, (pathname) =>
      jsonFixtureResponse(PLAN_PAGE_RESPONSES, pathname)
    );

    try {
      const text = rendered?.container.textContent ?? "";
      assert.match(text, USED_TOTAL_RE);
      assert.ok(text.includes("AI Credits"));
      assert.ok(text.includes("AI Credits: 2,000"));
      assert.ok(
        text.includes(
          `Resets: ${formatBillingDateTime("2026-08-31T00:00:00Z")}`
        )
      );
      assertTextOrder(text, [
        "Current Workspace Plan",
        "AI Credits",
        "1,200",
        "Account Balance",
      ]);
      const bar = rendered?.getByRole("progressbar", {
        name: "AI Credits used",
      });
      assert.equal(bar?.getAttribute("aria-valuenow"), "60");
      assert.equal(bar?.getAttribute("aria-valuemin"), "0");
      assert.equal(bar?.getAttribute("aria-valuemax"), "100");
      assert.equal(bar?.getAttribute("aria-valuetext"), "1,200 / 2,000");
      assert.ok(bar?.classList.contains("h-2"));
      assert.ok(bar?.classList.contains("bg-input"));
      assert.ok(bar?.firstElementChild?.classList.contains("bg-linear-to-r"));
      assert.ok(bar?.firstElementChild?.classList.contains("from-blue-950"));
      assert.ok(bar?.firstElementChild?.classList.contains("to-blue-500"));
      assert.equal(text.includes("Purchased Credits"), false);
      assert.equal(text.includes("Promotion Credits"), false);
      assert.equal(text.includes("Add Credits"), false);
    } finally {
      await restore();
    }
  });
});

test("PAYG Plan hides the AI Credits card when quota has no ai_quota keys", async () => {
  await withTestDom(async (act) => {
    const responses = planPageResponses({
      "/api/billing/subscription": {
        subscription: { type: "PAYG" },
      },
      "/api/billing/workspace-quota": {
        quota: { hard: { "limits.cpu": "4" }, used: { "limits.cpu": "1" } },
      },
    });
    const { rendered, restore } = await renderPlanPage(act, (pathname) =>
      jsonFixtureResponse(responses, pathname)
    );

    try {
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("Pay-As-You-Go"));
      assert.equal(text.includes("1,200 / 2,000"), false);
      assert.equal(rendered?.queryByRole("progressbar"), null);
      assert.equal(RESETS_LABEL_RE.test(text), false);
    } finally {
      await restore();
    }
  });
});

test("unused AI Credits render as 0 with an empty bar", async () => {
  await withTestDom(async (act) => {
    const responses = planPageResponses({
      "/api/billing/workspace-quota": {
        quota: {
          hard: { ai_quota: 20_000_000 },
          used: { ai_quota: 0 },
        },
      },
    });
    const { rendered, restore } = await renderPlanPage(act, (pathname) =>
      jsonFixtureResponse(responses, pathname)
    );

    try {
      const text = rendered?.container.textContent ?? "";
      assert.match(text, UNUSED_TOTAL_RE);
      assert.equal(
        rendered
          ?.getByRole("progressbar", { name: "AI Credits used" })
          .getAttribute("aria-valuenow"),
        "0"
      );
    } finally {
      await restore();
    }
  });
});

test("exhausted AI Credits clamp the bar at 100 percent", async () => {
  await withTestDom(async (act) => {
    const responses = planPageResponses({
      "/api/billing/workspace-quota": {
        quota: {
          hard: { ai_quota: 20_000_000 },
          used: { ai_quota: 25_000_000 },
        },
      },
    });
    const { rendered, restore } = await renderPlanPage(act, (pathname) =>
      jsonFixtureResponse(responses, pathname)
    );

    try {
      const text = rendered?.container.textContent ?? "";
      assert.match(text, OVERSHOOT_TOTAL_RE);
      assert.equal(
        rendered
          ?.getByRole("progressbar", { name: "AI Credits used" })
          .getAttribute("aria-valuenow"),
        "100"
      );
    } finally {
      await restore();
    }
  });
});

test("a workspace with no AI Credits allowance hides the card", async () => {
  await withTestDom(async (act) => {
    const responses = planPageResponses({
      "/api/billing/plans": {
        plans: [
          {
            AIQuota: 0,
            Description: "For growing workloads",
            ID: "plan-pro",
            MaxResources: JSON.stringify({ cpu: "4", memory: "8Gi" }),
            Name: "Pro",
            Order: 2,
            Prices: [{ BillingCycle: "1m", Price: 20_000_000 }],
            Tags: [],
            Traffic: 4096,
          },
        ],
      },
      "/api/billing/workspace-quota": {
        quota: { hard: {}, used: {} },
      },
    });
    const { rendered, restore } = await renderPlanPage(act, (pathname) =>
      jsonFixtureResponse(responses, pathname)
    );

    try {
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("Current Workspace Plan"));
      assert.equal(text.includes("AI Credits"), false);
      assert.equal(rendered?.queryByRole("progressbar"), null);
    } finally {
      await restore();
    }
  });
});

test("a failed AI Credits request keeps the card and degrades like Account Balance", async () => {
  await withTestDom(async (act) => {
    const { rendered, restore } = await renderPlanPage(act, (pathname) => {
      if (pathname === "/api/billing/workspace-quota") {
        return new Response(JSON.stringify({ error: "quota unavailable" }), {
          headers: { "content-type": "application/json" },
          status: 500,
        });
      }
      return jsonFixtureResponse(PLAN_PAGE_RESPONSES, pathname);
    });

    try {
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("Couldn’t load AI Credits."));
      assert.ok(text.includes("Current Workspace Plan"));
      assert.equal(rendered?.queryByRole("progressbar"), null);
    } finally {
      await restore();
    }
  });
});

test("Plan renders without waiting for the AI Credits request", async () => {
  await withTestDom(async (act) => {
    const { rendered, restore } = await renderPlanPage(act, (pathname) => {
      if (pathname === "/api/billing/workspace-quota") {
        return new Promise<Response>(() => undefined);
      }
      return jsonFixtureResponse(PLAN_PAGE_RESPONSES, pathname);
    });

    try {
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("Current Workspace Plan"));
      assert.ok(text.includes("Account Balance"));
      assert.ok(rendered?.getByLabelText("Loading AI Credits"));
      assert.equal(text.includes("1,200 / 2,000"), false);
    } finally {
      await restore();
    }
  });
});

test("Account Balance composes cash and usable credits without a Gift chip", async () => {
  // AIM-323 review: a paid plan's grant feeds the available total ($3.00
  // cash + $1.80 plan credits) but must never be labeled Gift.
  await withTestDom(async (act) => {
    const { rendered, restore } = await renderPlanPage(act, (pathname) =>
      jsonFixtureResponse(PLAN_PAGE_RESPONSES, pathname)
    );

    try {
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("Account Balance"));
      assert.ok(text.includes("$4.80"), "cash + usable credits renders");
      assert.equal(text.includes("Gift"), false, "plan credits are not Gift");
    } finally {
      await restore();
    }
  });
});

test("a failed credits request never voices Account Debt on cash alone", async () => {
  // Cash-only ≤ 0 while credits are unknown: unseen credits could still
  // cover the account, so the figure stays unvoiced instead of going red.
  await withTestDom(async (act) => {
    const responses = planPageResponses({
      "/api/billing/account": {
        account: { Balance: 0, DeductionBalance: 500_000 },
      },
    });
    const { rendered, restore } = await renderPlanPage(act, (pathname) => {
      if (pathname === "/api/billing/credits") {
        return new Response(JSON.stringify({ error: "credits unavailable" }), {
          headers: { "content-type": "application/json" },
          status: 500,
        });
      }
      return jsonFixtureResponse(responses, pathname);
    });

    try {
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("-$0.50"), "the cash figure still renders");
      assert.equal(
        text.includes("Top up from the Sealos Desktop"),
        false,
        "no debt caption without the credits term"
      );
    } finally {
      await restore();
    }
  });
});

const FREE_TRIAL_SUBSCRIPTION = {
  subscription: {
    CancelAtPeriodEnd: true,
    CurrentPeriodEndAt: "2026-09-01T00:00:00Z",
    ExpireAt: "2026-09-01T00:00:00Z",
    PayMethod: "stripe",
    PlanName: "Free",
    RegionDomain: "us.example.test",
    Status: "NORMAL",
    Workspace: "workspace-a",
    role: "OWNER" as const,
    type: "SUBSCRIPTION" as const,
  },
};

test("an Active Free Trial renders the allowance card in the credits slot, not AI Credits", async () => {
  await withTestDom(async (act) => {
    const responses = planPageResponses({
      "/api/billing/subscription": FREE_TRIAL_SUBSCRIPTION,
      "/api/chat/free-turns": { limit: 5, remaining: 3, used: 2 },
    });
    const { rendered, restore } = await renderPlanPage(act, (pathname) =>
      jsonFixtureResponse(responses, pathname)
    );

    try {
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("Free trial messages"));
      assert.ok(text.includes("Included with the Free plan"));
      assert.ok(text.includes("3 of 5 left"));
      // Same slot and hierarchy as the paid plans' AI Credits section.
      assertTextOrder(text, [
        "Current Workspace Plan",
        "Free trial messages",
        "Account Balance",
      ]);
      assert.equal(text.includes("AI Credits:"), false);
      assert.ok(
        rendered?.getByRole("progressbar", {
          name: "Free trial messages used",
        })
      );
    } finally {
      await restore();
    }
  });
});

test("a PAUSED Free workspace renders no allowance card and never asks Brain for usage", async () => {
  await withTestDom(async (act) => {
    const requestedPaths: string[] = [];
    const responses = planPageResponses({
      "/api/billing/subscription": {
        subscription: {
          ...FREE_TRIAL_SUBSCRIPTION.subscription,
          CurrentPeriodEndAt: "",
          ExpireAt: null,
          Status: "PAUSED",
        },
      },
      "/api/billing/workspace-quota": {
        quota: { hard: { ai_quota: 0 }, used: { ai_quota: 0 } },
      },
    });
    const { rendered, restore } = await renderPlanPage(act, (pathname) => {
      requestedPaths.push(pathname);
      return jsonFixtureResponse(responses, pathname);
    });

    try {
      const text = rendered?.container.textContent ?? "";
      assert.equal(text.includes("Free trial messages"), false);
      assert.equal(requestedPaths.includes("/api/chat/free-turns"), false);
    } finally {
      await restore();
    }
  });
});

test("a failed usage lookup degrades the allowance card quietly", async () => {
  await withTestDom(async (act) => {
    const responses = planPageResponses({
      "/api/billing/subscription": FREE_TRIAL_SUBSCRIPTION,
    });
    const { rendered, restore } = await renderPlanPage(act, (pathname) =>
      pathname === "/api/chat/free-turns"
        ? new Response("brain unavailable", { status: 503 })
        : jsonFixtureResponse(responses, pathname)
    );

    try {
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("Free trial messages"));
      assert.ok(
        text.includes(
          "Usage is unavailable right now — your free trial messages still work."
        )
      );
      assert.equal(text.includes("of 5 left"), false);
    } finally {
      await restore();
    }
  });
});

// --- Cancellation Survey (AIM-345, ADR-0072) ---------------------------------
// The cancel dialog's survey stage, the in-place confirmation, and the two
// funnel events, observed as the requests that leave the browser, what the
// person sees, and what lands in the GTM data layer.

const PAY_PATH = "/api/billing/subscription/pay";
const CANCELLATION_SURVEY_PATH =
  "/api/billing/subscription/cancellation-survey";
const SURVEY_PERIOD_END = "2099-08-31T00:00:00Z";
const CANCEL_DIALOG_NAME = "We are sorry to see you go";
const CONFIRMATION_DIALOG_NAME = "Cancellation scheduled";
const SURVEY_QUESTION_RE = /Before you go, what made you cancel\?/;
const THANK_YOU_RE = /Thank you for your feedback/;
const SELECT_ALL_RE = /Select all that apply\./;
const EMPTY_COUNTER_RE = /0\/500/;
const TYPED_COUNTER_RE = /34\/500/;
const CONFIRMATION_BODY_RE =
  /Your Pro plan stays active until Aug 31, 2099\. You can resume it anytime before then from the Plan view\./;

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    headers: { "content-type": "application/json" },
    status,
  });
}

/**
 * Answers the Plan page like account-service would across a cancel: the
 * subscription reads as active until the pay route confirms the cancel, then
 * as cancelling. Records the bodies of the two writes under test.
 */
function cancelFlowResponder(
  options: { payStatus?: number; surveyStatus?: number } = {}
) {
  const requests: { body: unknown; pathname: string }[] = [];
  let cancelled = false;
  const subscription = (
    PLAN_PAGE_RESPONSES["/api/billing/subscription"] as {
      subscription: Record<string, unknown>;
    }
  ).subscription;
  const respond = (pathname: string, init?: RequestInit): Response => {
    if (pathname === PAY_PATH || pathname === CANCELLATION_SURVEY_PATH) {
      requests.push({ body: JSON.parse(String(init?.body)), pathname });
    }
    if (pathname === PAY_PATH) {
      if (options.payStatus != null) {
        return errorResponse(options.payStatus, "Upstream refused the cancel.");
      }
      cancelled = true;
      return jsonResponse({ success: true });
    }
    if (pathname === CANCELLATION_SURVEY_PATH) {
      return options.surveyStatus == null
        ? jsonResponse({ id: "survey-1", ok: true })
        : errorResponse(options.surveyStatus, "Survey store unavailable.");
    }
    if (pathname === "/api/billing/subscription") {
      return jsonResponse({
        subscription: {
          ...subscription,
          CancelAtPeriodEnd: cancelled,
          CurrentPeriodEndAt: SURVEY_PERIOD_END,
          ExpireAt: SURVEY_PERIOD_END,
        },
      });
    }
    if (pathname in PLAN_PAGE_RESPONSES) {
      return jsonResponse(PLAN_PAGE_RESPONSES[pathname]);
    }
    return errorResponse(404, `not mocked: ${pathname}`);
  };
  return { requests, respond };
}

/**
 * A real focus plus a keyUp flush after the input: React falls back to
 * keystroke polling for change detection when react-dom was first loaded
 * without a DOM, as happens mid-suite, and drops a bare input event.
 */
function typeInto(field: HTMLElement, value: string) {
  field.focus();
  fireEvent.input(field, { target: { value } });
  fireEvent.keyUp(field, { key: "d" });
}

function installDataLayer(): unknown[] {
  const dataLayer: unknown[] = [];
  Object.assign(window, { dataLayer });
  return dataLayer;
}

function gtmEntry(event: Record<string, unknown>) {
  return { context: "app", module: "brain", ...event };
}

async function openCancelSurvey(
  act: Parameters<Parameters<typeof withTestDom>[0]>[0],
  rendered: ReturnType<typeof render> | undefined
): Promise<HTMLElement> {
  await act(() => {
    const trigger = rendered?.getByRole("button", { name: "Cancel Plan" });
    if (trigger != null) {
      fireEvent.click(trigger);
    }
  });
  const dialog = rendered?.getByRole("dialog", { name: CANCEL_DIALOG_NAME });
  assert.ok(dialog);
  return dialog;
}

test("Cancel Plan runs the survey: cancel first, survey second, confirmation in place", async () => {
  await withTestDom(async (act) => {
    const dataLayer = installDataLayer();
    const flow = cancelFlowResponder();
    const { rendered, restore } = await renderPlanPage(act, flow.respond);
    try {
      const dialog = await openCancelSurvey(act, rendered);
      assert.match(dialog.textContent ?? "", SURVEY_QUESTION_RE);
      assert.match(dialog.textContent ?? "", SELECT_ALL_RE);
      assert.match(dialog.textContent ?? "", EMPTY_COUNTER_RE);

      await act(() => {
        fireEvent.click(
          within(dialog).getByRole("button", { name: "The cost is too high" })
        );
      });
      await act(() => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Other" }));
      });
      const feedback = within(dialog).getByLabelText(
        "Additional feedback (optional)"
      );
      assert.equal(
        document.activeElement,
        feedback,
        "selecting Other hands focus to the text box"
      );
      assert.ok(
        within(dialog).getByRole("button", {
          name: "The cost is too high",
          pressed: true,
        })
      );
      await act(() => {
        typeInto(feedback, "  Too pricey for a side project.  ");
      });
      assert.match(dialog.textContent ?? "", TYPED_COUNTER_RE);

      await act(() => {
        fireEvent.click(
          within(dialog).getByRole("button", { name: "Cancel Plan" })
        );
      });

      assert.deepEqual(
        flow.requests.map((request) => request.pathname),
        [PAY_PATH, CANCELLATION_SURVEY_PATH],
        "account-service confirms the cancel before the survey is written"
      );
      assert.deepEqual(flow.requests[0]?.body, {
        operator: "canceled",
        payMethod: "stripe",
        planName: "Pro",
        regionDomain: "us.example.test",
        workspace: "workspace-a",
      });
      assert.deepEqual(flow.requests[1]?.body, {
        currentPeriodEndAt: SURVEY_PERIOD_END,
        feedback: "Too pricey for a side project.",
        planName: "Pro",
        reasons: ["too_expensive", "other"],
        regionDomain: "us.example.test",
        workspace: "workspace-a",
      });

      const confirmation = rendered?.getByRole("dialog", {
        name: CONFIRMATION_DIALOG_NAME,
      });
      assert.ok(confirmation);
      assert.match(confirmation.textContent ?? "", CONFIRMATION_BODY_RE);
      assert.match(confirmation.textContent ?? "", THANK_YOU_RE);
      // The Plan view behind it has already refreshed into cancelling (the
      // open modal keeps it inert, hence the hidden query) and the
      // confirmation survived that refresh.
      assert.ok(
        rendered?.getByRole("button", { hidden: true, name: "Resume Plan" })
      );
      assert.deepEqual(dataLayer, [
        gtmEntry({
          event: "subscription_cancel",
          has_feedback: true,
          plan_name: "Pro",
          reasons: ["too_expensive", "other"],
        }),
      ]);

      await act(() => {
        fireEvent.click(
          within(confirmation).getByRole("button", { name: "Close" })
        );
      });
      assert.equal(rendered?.queryByRole("dialog"), null);
      assert.equal(
        dataLayer.length,
        1,
        "leaving the confirmation is not a keep"
      );
    } finally {
      await restore();
    }
  });
});

test("Keep Plan and dismissal send nothing, report kept, and reset the survey", async () => {
  await withTestDom(async (act) => {
    const dataLayer = installDataLayer();
    const flow = cancelFlowResponder();
    const { rendered, restore } = await renderPlanPage(act, flow.respond);
    try {
      let dialog = await openCancelSurvey(act, rendered);
      await act(() => {
        fireEvent.click(
          within(dialog).getByRole("button", {
            name: "It's too complicated to use",
          })
        );
        typeInto(
          within(dialog).getByLabelText("Additional feedback (optional)"),
          "draft"
        );
      });
      await act(() => {
        fireEvent.click(
          within(dialog).getByRole("button", { name: "Keep Plan" })
        );
      });
      assert.equal(rendered?.queryByRole("dialog"), null);
      assert.deepEqual(
        flow.requests,
        [],
        "looking at the survey has no side effect"
      );
      assert.deepEqual(dataLayer, [
        gtmEntry({ event: "subscription_cancel_kept", plan_name: "Pro" }),
      ]);

      dialog = await openCancelSurvey(act, rendered);
      assert.ok(
        within(dialog).getByRole("button", {
          name: "It's too complicated to use",
          pressed: false,
        }),
        "a reopened survey starts empty"
      );
      assert.match(dialog.textContent ?? "", EMPTY_COUNTER_RE);
      await act(() => {
        fireEvent.keyDown(dialog, { key: "Escape" });
      });
      assert.equal(rendered?.queryByRole("dialog"), null);
      assert.deepEqual(flow.requests, []);
      assert.equal(dataLayer.length, 2, "Escape is a keep too");

      await openCancelSurvey(act, rendered);
      const overlay = document.querySelector('[data-slot="dialog-overlay"]');
      assert.ok(overlay, "the survey is modal");
      await act(() => {
        fireEvent.pointerDown(overlay);
        fireEvent.mouseDown(overlay);
        fireEvent.pointerUp(overlay);
        fireEvent.mouseUp(overlay);
        fireEvent.click(overlay);
      });
      assert.equal(rendered?.queryByRole("dialog"), null);
      assert.deepEqual(flow.requests, []);
      assert.equal(dataLayer.length, 3, "the overlay is a keep too");
    } finally {
      await restore();
    }
  });
});

test("a failing cancel shows the error inline and keeps the answers", async () => {
  await withTestDom(async (act) => {
    const dataLayer = installDataLayer();
    const flow = cancelFlowResponder({ payStatus: 500 });
    const { rendered, restore } = await renderPlanPage(act, flow.respond);
    try {
      const dialog = await openCancelSurvey(act, rendered);
      await act(() => {
        fireEvent.click(
          within(dialog).getByRole("button", {
            name: "I found a better alternative",
          })
        );
        typeInto(
          within(dialog).getByLabelText("Additional feedback (optional)"),
          "Moving to a competitor."
        );
      });
      await act(() => {
        fireEvent.click(
          within(dialog).getByRole("button", { name: "Cancel Plan" })
        );
      });

      assert.equal(
        within(dialog).getByRole("alert").textContent,
        "Upstream refused the cancel."
      );
      assert.ok(
        within(dialog).getByRole("button", {
          name: "I found a better alternative",
          pressed: true,
        })
      );
      assert.equal(
        (
          within(dialog).getByLabelText(
            "Additional feedback (optional)"
          ) as HTMLTextAreaElement
        ).value,
        "Moving to a competitor."
      );
      assert.deepEqual(
        flow.requests.map((request) => request.pathname),
        [PAY_PATH],
        "no survey row without a confirmed cancel"
      );
      assert.deepEqual(dataLayer, []);
      assert.equal(
        rendered?.queryByRole("dialog", { name: CONFIRMATION_DIALOG_NAME }),
        null
      );
    } finally {
      await restore();
    }
  });
});

test("an unanswered survey still cancels, and a failed survey write still confirms", async () => {
  await withTestDom(async (act) => {
    const dataLayer = installDataLayer();
    const flow = cancelFlowResponder({ surveyStatus: 503 });
    const { rendered, restore } = await renderPlanPage(act, flow.respond);
    try {
      const dialog = await openCancelSurvey(act, rendered);
      await act(() => {
        fireEvent.click(
          within(dialog).getByRole("button", { name: "Cancel Plan" })
        );
      });

      const confirmation = rendered?.getByRole("dialog", {
        name: CONFIRMATION_DIALOG_NAME,
      });
      assert.ok(confirmation);
      assert.match(confirmation.textContent ?? "", CONFIRMATION_BODY_RE);
      assert.doesNotMatch(
        confirmation.textContent ?? "",
        THANK_YOU_RE,
        "no thanks for feedback that was not given"
      );
      assert.equal(within(confirmation).queryByRole("alert"), null);
      assert.deepEqual(flow.requests[1]?.body, {
        currentPeriodEndAt: SURVEY_PERIOD_END,
        feedback: "",
        planName: "Pro",
        reasons: [],
        regionDomain: "us.example.test",
        workspace: "workspace-a",
      });
      assert.deepEqual(dataLayer, [
        gtmEntry({
          event: "subscription_cancel",
          has_feedback: false,
          plan_name: "Pro",
          reasons: [],
        }),
      ]);
    } finally {
      await restore();
    }
  });
});
