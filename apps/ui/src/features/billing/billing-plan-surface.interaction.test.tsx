import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render } from "@testing-library/react/pure";
import { useState } from "react";

import { withTestDom } from "@/features/project-canvas/react-test-harness";
import type {
  BillingPlanSnapshot,
  SubscriptionLifecycleAction,
} from "./billing-plan-data";

const CANCELLING_BANNER_PATTERN = /Your subscription is being cancelled/;
const CANCELLING_PATTERN = /Cancelling/;

const CANCELLING_PLAN: BillingPlanSnapshot = {
  card: { brand: "visa", last4: "4242" },
  current: {
    canManage: true,
    cancelAtPeriodEnd: true,
    currentPeriodEndAt: "2099-08-31T00:00:00Z",
    expireAt: "2099-08-31T00:00:00Z",
    invoiceId: null,
    invoicePaymentUrl: null,
    isPayg: false,
    lifecycle: "cancelling",
    payMethod: "stripe",
    planName: "Pro",
    priceMicroUnits: 20_000_000,
    regionDomain: "us.example.test",
    resources: [{ label: "CPU", value: "4" }],
    workspace: "workspace-a",
  },
  pendingDowngrade: null,
  pendingUpgrade: null,
  plans: [],
  workspaces: [],
};

test("resume refreshes the Plan lifecycle state", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanSurface } = await import("./billing-plan-surface");
    const actions: SubscriptionLifecycleAction[] = [];

    function Harness() {
      const [snapshot, setSnapshot] = useState(CANCELLING_PLAN);
      return (
        <BillingPlanSurface
          balance={<span>$3.00</span>}
          currency="usd"
          onLifecycleAction={(operator) => {
            actions.push(operator);
            setSnapshot((current) => ({
              ...current,
              current: {
                ...current.current,
                cancelAtPeriodEnd: false,
                lifecycle: "active",
              },
            }));
            return undefined;
          }}
          snapshot={snapshot}
        />
      );
    }

    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(<Harness />);
      });

      assert.match(rendered?.container.textContent ?? "", CANCELLING_PATTERN);
      assert.match(
        rendered?.container.textContent ?? "",
        CANCELLING_BANNER_PATTERN
      );

      await act(() => {
        const resume = rendered?.getByRole("button", {
          name: "Resume Plan",
        });
        if (resume != null) {
          fireEvent.click(resume);
        }
      });

      assert.deepEqual(actions, ["resumed"]);
      assert.doesNotMatch(
        rendered?.container.textContent ?? "",
        CANCELLING_PATTERN
      );
      assert.equal(
        (rendered?.container.textContent ?? "").includes(
          "Your subscription is being cancelled"
        ),
        false
      );
      assert.ok(rendered?.getByRole("button", { name: "Cancel Plan" }));
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("saved card management is exposed as a Plan action", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanSurface } = await import("./billing-plan-surface");
    let manageRequests = 0;
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await act(() => {
        rendered = render(
          <BillingPlanSurface
            balance={<span>$3.00</span>}
            currency="usd"
            onManageCard={() => {
              manageRequests += 1;
            }}
            snapshot={CANCELLING_PLAN}
          />
        );
      });

      await act(() => {
        const manageCard = rendered?.getByRole("button", {
          name: "Manage Card Info",
        });
        if (manageCard != null) {
          fireEvent.click(manageCard);
        }
      });

      assert.equal(manageRequests, 1);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("an unpaid invoice can be cancelled from its Plan banner", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanSurface } = await import("./billing-plan-surface");
    const invoiceIds: string[] = [];
    const snapshot: BillingPlanSnapshot = {
      ...CANCELLING_PLAN,
      current: {
        ...CANCELLING_PLAN.current,
        invoiceId: "invoice-1",
        invoicePaymentUrl: "https://payments.example.test/invoice-1",
      },
    };
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await act(() => {
        rendered = render(
          <BillingPlanSurface
            balance={<span>$3.00</span>}
            currency="usd"
            onCancelInvoice={(invoiceId) => invoiceIds.push(invoiceId)}
            snapshot={snapshot}
          />
        );
      });

      assert.ok(
        rendered?.getByRole("link", {
          name: "Pay invoice",
        })
      );
      await act(() => {
        const cancelInvoice = rendered?.getByRole("button", {
          name: "Cancel invoice",
        });
        if (cancelInvoice != null) {
          fireEvent.click(cancelInvoice);
        }
      });

      assert.deepEqual(invoiceIds, ["invoice-1"]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("a payment-due subscription exposes the renewal action", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanSurface } = await import("./billing-plan-surface");
    let renewalRequests = 0;
    const snapshot: BillingPlanSnapshot = {
      ...CANCELLING_PLAN,
      current: {
        ...CANCELLING_PLAN.current,
        cancelAtPeriodEnd: false,
        lifecycle: "payment-due",
      },
    };
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await act(() => {
        rendered = render(
          <BillingPlanSurface
            balance={<span>$3.00</span>}
            currency="usd"
            onRenew={() => {
              renewalRequests += 1;
            }}
            snapshot={snapshot}
          />
        );
      });

      await act(() => {
        const renew = rendered?.getByRole("button", {
          name: "Renew Plan",
        });
        if (renew != null) {
          fireEvent.click(renew);
        }
      });

      assert.equal(renewalRequests, 1);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("plan actions open the change workflow with the selected plan", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanSurface } = await import("./billing-plan-surface");
    const selections: Array<string | null> = [];
    const snapshot: BillingPlanSnapshot = {
      ...CANCELLING_PLAN,
      current: {
        ...CANCELLING_PLAN.current,
        cancelAtPeriodEnd: false,
        lifecycle: "active",
      },
      plans: [
        {
          changeKind: "downgrade",
          description: "For personal projects",
          id: "starter",
          isCurrent: false,
          limits: { cpu: "1" },
          name: "Starter",
          order: 1,
          priceMicroUnits: 5_000_000,
          resources: [{ label: "CPU", value: "1" }],
        },
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
    };
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await act(() => {
        rendered = render(
          <BillingPlanSurface
            balance={<span>$3.00</span>}
            currency="usd"
            onPlanChange={(planId) => selections.push(planId)}
            snapshot={snapshot}
          />
        );
      });

      await act(() => {
        const changePlan = rendered?.getByRole("button", {
          name: "Upgrade Plan",
        });
        if (changePlan != null) {
          fireEvent.click(changePlan);
        }
      });

      assert.deepEqual(selections, [null]);
      assert.equal(
        rendered?.queryByRole("button", { name: "Upgrade to Team" }),
        null
      );
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("a PAYG workspace exposes only the subscribe entry point", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanSurface } = await import("./billing-plan-surface");
    const selections: Array<string | null> = [];
    const snapshot: BillingPlanSnapshot = {
      ...CANCELLING_PLAN,
      card: null,
      current: {
        ...CANCELLING_PLAN.current,
        cancelAtPeriodEnd: false,
        currentPeriodEndAt: "",
        isPayg: true,
        lifecycle: "active",
        planName: "PAYG",
        priceMicroUnits: 0,
      },
    };
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await act(() => {
        rendered = render(
          <BillingPlanSurface
            balance={<span>$3.00</span>}
            currency="usd"
            onPlanChange={(planId) => selections.push(planId)}
            snapshot={snapshot}
          />
        );
      });

      assert.equal(
        rendered?.queryByRole("button", { name: "Cancel Plan" }),
        null
      );
      assert.equal(
        rendered?.queryByRole("button", { name: "Upgrade Plan" }),
        null
      );
      await act(() => {
        const subscribe = rendered?.getByRole("button", {
          name: "Subscribe Plan",
        });
        if (subscribe != null) {
          fireEvent.click(subscribe);
        }
      });

      assert.deepEqual(selections, [null]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});
