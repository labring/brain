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
import { formatBillingDateTime } from "./billing-datetime";
import type { BillingPlanSnapshot } from "./billing-plan-data";

const SNAPSHOT: BillingPlanSnapshot = {
  card: { brand: "visa", last4: "4242" },
  current: {
    canManage: true,
    cancelAtPeriodEnd: false,
    currentPeriodEndAt: "2026-08-31T00:00:00Z",
    expireAt: "2026-08-31T00:00:00Z",
    invoiceId: null,
    invoicePaymentUrl: null,
    isPayg: false,
    lifecycle: "active",
    payMethod: "stripe",
    planName: "Pro",
    priceMicroUnits: 20_000_000,
    regionDomain: "us.example.test",
    resourceDeletionAt: null,
    resources: [{ label: "CPU", value: "4" }],
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
      assert.ok(
        rendered?.getByRole("dialog", {
          name: "Congratulations!",
        })
      );
      assert.ok(
        (rendered?.baseElement.textContent ?? "").includes(
          "workspace-a is now on Team"
        )
      );
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
    regions: [{ domain: "us.example.test", uid: "region-us" }],
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
        "1,200 / 2,000",
        "Account Balance",
      ]);
      const bar = rendered?.getByRole("progressbar", {
        name: "AI Credits used",
      });
      assert.equal(bar?.getAttribute("aria-valuenow"), "60");
      assert.equal(bar?.getAttribute("aria-valuemin"), "0");
      assert.equal(bar?.getAttribute("aria-valuemax"), "100");
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
      assert.ok(text.includes("AI Credits is unavailable."));
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
