import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render } from "@testing-library/react/pure";

import { withTestDom } from "@/features/project-canvas/react-test-harness";
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
    resources: [{ label: "CPU", value: "4" }],
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
