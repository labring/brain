import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render } from "@testing-library/react/pure";
import { useState } from "react";

import { withTestDom } from "@/features/project-canvas/react-test-harness";
import { formatBillingDate } from "./billing-datetime";
import type { BillingPlanSnapshot } from "./billing-plan-data";
import type { BillingMeteredPrice } from "./billing-pricing-data";

const PLAN_SNAPSHOT: BillingPlanSnapshot = {
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

const PRICES: BillingMeteredPrice[] = [
  {
    hourlyPriceMicroUnits: 10_000,
    label: "CPU",
    billingBasis: "duration",
    sourceName: "cpu",
    type: "cpu",
    unit: "vCPU",
  },
  {
    hourlyPriceMicroUnits: 20_480,
    label: "Memory",
    billingBasis: "duration",
    sourceName: "memory",
    type: "memory",
    unit: "GiB",
  },
  {
    hourlyPriceMicroUnits: 2,
    label: "Network traffic",
    billingBasis: "quantity",
    sourceName: "network",
    type: "network",
    unit: "MiB",
  },
  {
    hourlyPriceMicroUnits: 750_000,
    label: "NVIDIA A100",
    billingBasis: "duration",
    sourceName: "gpu-a100",
    type: "gpu",
    unit: "GPU",
  },
];

function editNumberInput(input: Element | undefined, value: string) {
  if (input == null) {
    return;
  }
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value } });
  fireEvent.keyUp(input, { key: value.at(-1) ?? "0" });
}

test("calculator updates timed resources and one-time traffic in cluster currency", async () => {
  await withTestDom(async (act) => {
    const { BillingCalculator } = await import("./billing-pricing");
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <BillingCalculator
            currency="usd"
            gpuEnabled={false}
            prices={PRICES}
          />
        );
      });

      assert.ok(rendered?.getByText("$0.030480"));
      await act(() => {
        editNumberInput(rendered?.getByLabelText("CPU"), "2");
        editNumberInput(rendered?.getByLabelText("Duration"), "2");
        editNumberInput(rendered?.getByLabelText("Network traffic"), "100");
      });

      assert.ok(rendered?.getByText("$0.081160"));
      assert.equal(rendered?.queryByLabelText("GPU count"), null);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("calculator includes GPU controls and pricing only when enabled", async () => {
  await withTestDom(async (act) => {
    const { BillingCalculator } = await import("./billing-pricing");
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <BillingCalculator currency="usd" gpuEnabled prices={PRICES} />
        );
      });

      assert.ok(rendered?.getByLabelText("GPU model"));
      await act(() => {
        editNumberInput(rendered?.getByLabelText("GPU count"), "1");
      });
      assert.ok(rendered?.getByText("$0.780480"));
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("a payment started from Pricing ends in the shared congratulations", async () => {
  await withTestDom(async (act) => {
    const { BillingPricingCheckout } = await import("./billing-pricing");
    const scheduled: Array<() => void> = [];
    const refreshedSnapshot: BillingPlanSnapshot = {
      ...PLAN_SNAPSHOT,
      current: {
        ...PLAN_SNAPSHOT.current,
        planName: "Team",
        priceMicroUnits: 50_000_000,
        resources: [{ label: "CPU", value: "12" }],
      },
    };
    let rendered: ReturnType<typeof render> | undefined;

    function PricingCheckoutHarness() {
      const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
        "team"
      );
      return (
        <BillingPricingCheckout
          credentials={{
            appToken: "desktop-app-token",
            kubeconfig: "apiVersion: v1",
          }}
          currency="usd"
          gpuEnabled
          onClearSelection={() => setSelectedPlanId(null)}
          onSubscriptionChanged={() => Promise.resolve(refreshedSnapshot)}
          planSnapshot={PLAN_SNAPSHOT}
          schedulePoll={(run) => {
            scheduled.push(run);
            return () => undefined;
          }}
          selectedPlanId={selectedPlanId}
          services={{
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
        />
      );
    }

    try {
      await act(() => {
        rendered = render(<PricingCheckoutHarness />);
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

      assert.equal(
        rendered?.queryByRole("button", { name: "Cancel payment" }),
        null
      );
      assert.ok(rendered?.getByRole("dialog", { name: "Team" }));
      const congratulations = rendered?.baseElement.textContent ?? "";
      assert.ok(congratulations.includes("workspace-a"));
      assert.ok(congratulations.includes("Charged today"));
      assert.ok(congratulations.includes("$31.69"));
      assert.ok(
        congratulations.includes(
          `Billed monthly from ${formatBillingDate("2026-08-31T00:00:00Z")}`
        )
      );
      assert.ok(congratulations.includes("$50.00"));
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});
