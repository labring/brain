import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render } from "@testing-library/react/pure";
import { useState } from "react";

import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import type {
  BillingPlanSnapshot,
  SubscriptionLifecycleAction,
} from "./billing-plan-data";

const ACTIVE_PATTERN = /Active/;
const CANCELLING_BANNER_PATTERN = /Your subscription is being cancelled/;
const CANCELLING_PATTERN = /Cancelling/;

const CANCELLING_PLAN: BillingPlanSnapshot = {
  card: { brand: "visa", last4: "4242" },
  current: {
    canManage: true,
    cancelAtPeriodEnd: true,
    currentPeriodEndAt: "2099-08-31T00:00:00Z",
    expireAt: "2099-08-31T00:00:00Z",
    invoicePaymentUrl: null,
    lifecycle: "cancelling",
    payMethod: "stripe",
    planName: "Pro",
    priceMicroUnits: 20_000_000,
    regionDomain: "us.example.test",
    resources: [{ label: "CPU", value: "4" }],
    workspace: "workspace-a",
  },
  pendingUpgrade: null,
  plans: [],
  workspaces: [],
};

async function withTestDom(run: (act: typeof actAndDrain) => Promise<void>) {
  const dom = installTestDom();
  const previousAct = setActEnvironment(true);
  try {
    await run(actAndDrain);
  } finally {
    restoreActEnvironment(previousAct);
    await dom.restore();
  }
}

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
          name: "Resume subscription",
        });
        if (resume != null) {
          fireEvent.click(resume);
        }
      });

      assert.deepEqual(actions, ["resumed"]);
      assert.match(rendered?.container.textContent ?? "", ACTIVE_PATTERN);
      assert.equal(
        (rendered?.container.textContent ?? "").includes(
          "Your subscription is being cancelled"
        ),
        false
      );
      assert.ok(rendered?.getByRole("button", { name: "Cancel subscription" }));
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});
