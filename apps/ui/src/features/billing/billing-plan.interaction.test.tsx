import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render } from "@testing-library/react/pure";
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
                  payId: "payment-1",
                  planName: "Team",
                  status: "completed",
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
  respond: (pathname: string) => Response | Promise<Response>
) {
  const override = defineGlobal("fetch", (input: unknown) => {
    const pathname = new URL(requestUrl(input), "https://brain.example.test")
      .pathname;
    return Promise.resolve(respond(pathname));
  });
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
      assert.ok(text.includes("Free assistant messages"));
      assert.ok(text.includes("Included with the Free plan"));
      assert.ok(text.includes("3 of 5 left"));
      // Same slot and hierarchy as the paid plans' AI Credits section.
      assertTextOrder(text, [
        "Current Workspace Plan",
        "Free assistant messages",
        "Account Balance",
      ]);
      assert.equal(text.includes("AI Credits:"), false);
      assert.ok(
        rendered?.getByRole("progressbar", {
          name: "Free assistant messages used",
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
      assert.equal(text.includes("Free assistant messages"), false);
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
      assert.ok(text.includes("Free assistant messages"));
      assert.ok(
        text.includes(
          "Usage is unavailable right now — your free messages still work."
        )
      );
      assert.equal(text.includes("of 5 left"), false);
    } finally {
      await restore();
    }
  });
});
