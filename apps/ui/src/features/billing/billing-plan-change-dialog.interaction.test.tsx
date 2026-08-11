import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render, within } from "@testing-library/react/pure";
import { useState } from "react";

import { withTestDom } from "@/features/project-canvas/react-test-harness";
import {
  type BillingPlanSnapshot,
  SubscriptionPromotionCodeError,
} from "./billing-plan-data";

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
      changeKind: "downgrade",
      description: "For personal projects",
      id: "starter",
      isCurrent: false,
      limits: { cpu: "1", memory: "2Gi" },
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
      limits: { cpu: "4", memory: "8Gi" },
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
      limits: { cpu: "12", memory: "24Gi" },
      name: "Team",
      order: 3,
      priceMicroUnits: 50_000_000,
      resources: [{ label: "CPU", value: "12" }],
    },
  ],
  workspaces: [],
};

test("plan picker continues into the selected upgrade workflow", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanChangeDialog } = await import(
      "./billing-plan-change-dialog"
    );
    let rendered: ReturnType<typeof render> | undefined;

    function PlanPickerHarness() {
      const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
      return (
        <BillingPlanChangeDialog
          credentials={{
            appToken: "desktop-app-token",
            kubeconfig: "apiVersion: v1",
          }}
          currency="usd"
          gpuEnabled
          onOpenChange={() => undefined}
          onSelectedPlanChange={setSelectedPlanId}
          onSubscriptionChanged={() => Promise.resolve()}
          open
          selectedPlanId={selectedPlanId}
          services={{
            cancelInvoice: () => Promise.resolve(),
            checkDowngrade: () =>
              Promise.resolve({ allowed: true, exceededResources: [] }),
            createPayment: () =>
              Promise.resolve({
                invoiceId: null,
                payId: null,
                redirectUrl: null,
                success: true,
              }),
            loadTransaction: () => Promise.resolve(null),
            loadUpgradeQuote: () =>
              Promise.resolve({
                amountMicroUnits: 9_000_000,
                discountMicroUnits: 0,
                hasDiscount: false,
                originalAmountMicroUnits: 9_000_000,
                promotionCode: "",
              }),
            openCheckoutUrl: () => undefined,
            openCheckoutWindow: () => null,
            redirectTop: () => undefined,
          }}
          snapshot={SNAPSHOT}
        />
      );
    }

    try {
      await act(() => {
        rendered = render(<PlanPickerHarness />);
      });

      assert.ok(
        (rendered?.baseElement.textContent ?? "").includes(
          "Choose Your Workspace Plan"
        )
      );
      await act(() => {
        const selectTeam = rendered?.getByRole("button", { name: "Upgrade" });
        if (selectTeam != null) {
          fireEvent.click(selectTeam);
        }
      });

      const text = rendered?.baseElement.textContent ?? "";
      assert.ok(text.includes("Change Plan"));
      assert.ok(text.includes("Order summary"));
      assert.ok(text.includes("Team"));
      assert.ok(text.includes("Due today"));
      assert.ok(text.includes("$9.00"));
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("upgrade confirmation shows the quote before reserving checkout at click time", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanChangeDialog } = await import(
      "./billing-plan-change-dialog"
    );
    const events: string[] = [];
    let rendered: ReturnType<typeof render> | undefined;
    const services = {
      cancelInvoice: () => Promise.resolve(),
      checkDowngrade: () =>
        Promise.resolve({ allowed: true, exceededResources: [] }),
      createPayment: () => {
        events.push("create-payment");
        return Promise.resolve({
          invoiceId: "invoice-1",
          payId: "payment-1",
          redirectUrl: "https://checkout.stripe.test/invoice-1",
          success: true,
        });
      },
      loadTransaction: () => Promise.resolve(null),
      loadUpgradeQuote: () =>
        Promise.resolve({
          amountMicroUnits: 7_500_000,
          discountMicroUnits: 1_500_000,
          hasDiscount: true,
          originalAmountMicroUnits: 9_000_000,
          promotionCode: "SAVE20",
        }),
      openCheckoutUrl: () => undefined,
      openCheckoutWindow: () => {
        events.push("open-window");
        return {
          close: () => undefined,
          navigate: () => events.push("navigate-window"),
        };
      },
      redirectTop: () => undefined,
    };
    const dialog = () => (
      <BillingPlanChangeDialog
        credentials={{
          appToken: "desktop-app-token",
          kubeconfig: "apiVersion: v1",
        }}
        currency="usd"
        gpuEnabled
        onOpenChange={() => undefined}
        onSubscriptionChanged={() => Promise.resolve()}
        open
        selectedPlanId="team"
        services={services}
        snapshot={SNAPSHOT}
      />
    );

    try {
      await act(() => {
        rendered = render(dialog());
      });

      const text = rendered?.baseElement.textContent ?? "";
      assert.ok(text.includes("Due today"));
      assert.ok(text.includes("$7.50"));

      await act(() => {
        const confirm = rendered?.getByRole("button", {
          name: "Subscribe & Pay",
        });
        if (confirm != null) {
          fireEvent.click(confirm);
        }
      });

      assert.deepEqual(events.slice(0, 3), [
        "open-window",
        "create-payment",
        "navigate-window",
      ]);
      assert.ok(
        (rendered?.baseElement.textContent ?? "").includes(
          "Waiting for payment"
        )
      );

      await act(() => rendered?.rerender(dialog()));
      assert.ok(
        (rendered?.baseElement.textContent ?? "").includes(
          "Waiting for payment"
        )
      );
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("upgrade confirmation shows distinct promotion-code errors", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanChangeDialog } = await import(
      "./billing-plan-change-dialog"
    );
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await act(() => {
        rendered = render(
          <BillingPlanChangeDialog
            credentials={{
              appToken: "desktop-app-token",
              kubeconfig: "apiVersion: v1",
            }}
            currency="usd"
            gpuEnabled
            onOpenChange={() => undefined}
            onSubscriptionChanged={() => Promise.resolve()}
            open
            selectedPlanId="team"
            services={{
              cancelInvoice: () => Promise.resolve(),
              checkDowngrade: () =>
                Promise.resolve({ allowed: true, exceededResources: [] }),
              createPayment: () =>
                Promise.resolve({
                  invoiceId: null,
                  payId: null,
                  redirectUrl: null,
                  success: true,
                }),
              loadTransaction: () => Promise.resolve(null),
              loadUpgradeQuote: ({ promotionCode }) => {
                const kind = {
                  EXHAUSTED: "exhausted",
                  EXPIRED: "expired",
                  UNKNOWN: "unknown",
                }[promotionCode ?? ""] as
                  | "exhausted"
                  | "expired"
                  | "unknown"
                  | undefined;
                if (kind != null) {
                  return Promise.reject(
                    new SubscriptionPromotionCodeError(kind)
                  );
                }
                return Promise.resolve({
                  amountMicroUnits: 9_000_000,
                  discountMicroUnits: 0,
                  hasDiscount: false,
                  originalAmountMicroUnits: 9_000_000,
                  promotionCode: "",
                });
              },
              openCheckoutUrl: () => undefined,
              openCheckoutWindow: () => null,
              redirectTop: () => undefined,
            }}
            snapshot={SNAPSHOT}
          />
        );
      });

      // The promo input hides behind a disclosure link until asked for.
      await act(() => {
        const reveal = rendered?.getByRole("button", {
          name: "Have a promo code?",
        });
        if (reveal != null) {
          fireEvent.click(reveal);
        }
      });

      for (const [code, message] of [
        ["UNKNOWN", "was not found"],
        ["EXPIRED", "has expired"],
        ["EXHAUSTED", "fully redeemed"],
      ] as const) {
        await act(() => {
          const input = rendered?.getByLabelText("Promotion code");
          if (input != null) {
            fireEvent.focus(input);
            fireEvent.input(input, { target: { value: code } });
            fireEvent.keyUp(input, { key: code.at(-1) ?? "" });
          }
        });
        await act(() => {
          const apply = rendered?.getByRole("button", { name: "Apply code" });
          if (apply != null) {
            fireEvent.click(apply);
          }
        });

        assert.ok((rendered?.baseElement.textContent ?? "").includes(message));
      }
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("an exceeded target quota warns but never blocks the downgrade", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanChangeDialog } = await import(
      "./billing-plan-change-dialog"
    );
    let paymentRequests = 0;
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await act(() => {
        rendered = render(
          <BillingPlanChangeDialog
            credentials={{
              appToken: "desktop-app-token",
              kubeconfig: "apiVersion: v1",
            }}
            currency="usd"
            gpuEnabled
            onOpenChange={() => undefined}
            onSubscriptionChanged={() => Promise.resolve()}
            open
            selectedPlanId="starter"
            services={{
              cancelInvoice: () => Promise.resolve(),
              checkDowngrade: () =>
                Promise.resolve({
                  allowed: false,
                  exceededResources: [
                    { label: "CPU", limit: "1", used: "1.5" },
                    { label: "Storage", limit: "10Gi", used: "12Gi" },
                  ],
                }),
              createPayment: () => {
                paymentRequests += 1;
                return Promise.resolve({
                  invoiceId: null,
                  payId: null,
                  redirectUrl: null,
                  success: true,
                });
              },
              loadTransaction: () => Promise.resolve(null),
              loadUpgradeQuote: () => Promise.reject(new Error("not used")),
              openCheckoutUrl: () => undefined,
              openCheckoutWindow: () => null,
              redirectTop: () => undefined,
            }}
            snapshot={SNAPSHOT}
          />
        );
      });

      const text = rendered?.baseElement.textContent ?? "";
      assert.ok(text.includes("Downgrade to Starter"));
      assert.ok(text.includes("CPU: 1.5 used, 1 available"));
      assert.ok(text.includes("Storage: 12Gi used, 10Gi available"));
      const confirm = rendered?.getByRole("button", {
        name: "Confirm downgrade",
      });
      assert.equal(confirm?.hasAttribute("disabled"), false);
      if (confirm != null) {
        await act(() => {
          fireEvent.click(confirm);
        });
      }
      assert.equal(paymentRequests, 1);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("an allowed downgrade keeps the top-level single-tab checkout", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanChangeDialog } = await import(
      "./billing-plan-change-dialog"
    );
    const events: string[] = [];
    let requestedOperator = "";
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await act(() => {
        rendered = render(
          <BillingPlanChangeDialog
            credentials={{
              appToken: "desktop-app-token",
              kubeconfig: "apiVersion: v1",
            }}
            currency="usd"
            gpuEnabled
            onOpenChange={() => undefined}
            onSubscriptionChanged={() => Promise.resolve()}
            open
            selectedPlanId="starter"
            services={{
              cancelInvoice: () => Promise.resolve(),
              checkDowngrade: () =>
                Promise.resolve({ allowed: true, exceededResources: [] }),
              createPayment: (input) => {
                requestedOperator = input.operator;
                events.push("create-payment");
                return Promise.resolve({
                  invoiceId: null,
                  payId: "payment-2",
                  redirectUrl: "https://checkout.stripe.test/downgrade",
                  success: true,
                });
              },
              loadTransaction: () => Promise.resolve(null),
              loadUpgradeQuote: () => Promise.reject(new Error("not used")),
              openCheckoutUrl: () => undefined,
              openCheckoutWindow: () => {
                events.push("open-window");
                return null;
              },
              redirectTop: (url) => events.push(`redirect:${url}`),
            }}
            snapshot={SNAPSHOT}
          />
        );
      });

      await act(() => {
        const confirm = rendered?.getByRole("button", {
          name: "Confirm downgrade",
        });
        if (confirm != null) {
          fireEvent.click(confirm);
        }
      });

      assert.equal(requestedOperator, "downgraded");
      assert.deepEqual(events, [
        "create-payment",
        "redirect:https://checkout.stripe.test/downgrade",
      ]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("upgrade waiting ignores other payments, polls, times out, reopens, and cancels", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanChangeDialog } = await import(
      "./billing-plan-change-dialog"
    );
    const events: string[] = [];
    const scheduledDelays: number[] = [];
    let now = 0;
    let scheduledPoll: (() => void) | undefined;
    let rendered: ReturnType<typeof render> | undefined;

    try {
      await act(() => {
        rendered = render(
          <BillingPlanChangeDialog
            credentials={{
              appToken: "desktop-app-token",
              kubeconfig: "apiVersion: v1",
            }}
            currency="usd"
            gpuEnabled
            now={() => now}
            onOpenChange={(nextOpen) => events.push(`open:${String(nextOpen)}`)}
            onSubscriptionChanged={() => {
              events.push("refresh");
              return Promise.resolve();
            }}
            open
            schedulePoll={(callback, delay) => {
              scheduledDelays.push(delay);
              scheduledPoll = callback;
              return () => undefined;
            }}
            selectedPlanId="team"
            services={{
              cancelInvoice: ({ invoiceId }) => {
                events.push(`cancel:${invoiceId}`);
                return Promise.resolve();
              },
              checkDowngrade: () =>
                Promise.resolve({ allowed: true, exceededResources: [] }),
              createPayment: () =>
                Promise.resolve({
                  invoiceId: "invoice-1",
                  payId: null,
                  redirectUrl: "https://checkout.stripe.test/invoice-1",
                  success: true,
                }),
              loadTransaction: () => {
                events.push("poll");
                return Promise.resolve({
                  id: "transaction-1",
                  payId: "payment-old",
                  planName: "Team",
                  status: "completed",
                });
              },
              loadUpgradeQuote: () =>
                Promise.resolve({
                  amountMicroUnits: 7_500_000,
                  discountMicroUnits: 0,
                  hasDiscount: false,
                  originalAmountMicroUnits: 7_500_000,
                  promotionCode: "",
                }),
              openCheckoutUrl: (url) => events.push(`reopen:${url}`),
              openCheckoutWindow: () => ({
                close: () => undefined,
                navigate: () => undefined,
              }),
              redirectTop: () => undefined,
            }}
            snapshot={SNAPSHOT}
          />
        );
      });
      await act(() => {
        const confirm = rendered?.getByRole("button", {
          name: "Subscribe & Pay",
        });
        if (confirm != null) {
          fireEvent.click(confirm);
        }
      });

      assert.equal(events.filter((event) => event === "poll").length, 1);
      assert.deepEqual(scheduledDelays, [3000]);

      await act(() => {
        const reopen = rendered?.getByRole("button", {
          name: "Reopen payment page",
        });
        if (reopen != null) {
          fireEvent.click(reopen);
        }
      });
      assert.ok(
        events.includes("reopen:https://checkout.stripe.test/invoice-1")
      );

      now = 10 * 60 * 1000 + 1;
      await act(() => scheduledPoll?.());
      assert.ok(
        (rendered?.baseElement.textContent ?? "").includes("Payment timed out")
      );

      await act(() => {
        const cancel = rendered?.getByRole("button", {
          name: "Cancel payment",
        });
        if (cancel != null) {
          fireEvent.click(cancel);
        }
      });
      assert.ok(events.includes("cancel:invoice-1"));
      assert.ok(events.includes("refresh"));
      assert.ok(events.includes("open:false"));
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("a PAYG workspace subscribes to a plan with the created operator", async () => {
  await withTestDom(async (act) => {
    const { BillingPlanChangeDialog } = await import(
      "./billing-plan-change-dialog"
    );
    const quoteOperators: Array<string | undefined> = [];
    const paymentOperators: string[] = [];
    let rendered: ReturnType<typeof render> | undefined;

    const paygSnapshot: BillingPlanSnapshot = {
      ...SNAPSHOT,
      current: {
        ...SNAPSHOT.current,
        isPayg: true,
        planName: "PAYG",
        priceMicroUnits: 0,
      },
      plans: SNAPSHOT.plans.map((plan) => ({
        ...plan,
        changeKind: "subscribe" as const,
        isCurrent: false,
      })),
    };

    function PaygHarness() {
      const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
      return (
        <BillingPlanChangeDialog
          credentials={{
            appToken: "desktop-app-token",
            kubeconfig: "apiVersion: v1",
          }}
          currency="usd"
          gpuEnabled
          onOpenChange={() => undefined}
          onSelectedPlanChange={setSelectedPlanId}
          onSubscriptionChanged={() => Promise.resolve()}
          open
          selectedPlanId={selectedPlanId}
          services={{
            cancelInvoice: () => Promise.resolve(),
            checkDowngrade: () => Promise.reject(new Error("not used")),
            createPayment: (input) => {
              paymentOperators.push(input.operator);
              return Promise.resolve({
                invoiceId: null,
                payId: null,
                redirectUrl: "https://checkout.stripe.test/subscribe-1",
                success: true,
              });
            },
            loadTransaction: () => Promise.resolve(null),
            loadUpgradeQuote: (input) => {
              quoteOperators.push(input.operator);
              return Promise.resolve({
                amountMicroUnits: 20_000_000,
                discountMicroUnits: 0,
                hasDiscount: false,
                originalAmountMicroUnits: 20_000_000,
                promotionCode: "",
              });
            },
            openCheckoutUrl: () => undefined,
            openCheckoutWindow: () => ({
              close: () => undefined,
              navigate: () => undefined,
            }),
            redirectTop: () => undefined,
          }}
          snapshot={paygSnapshot}
        />
      );
    }

    try {
      await act(() => {
        rendered = render(<PaygHarness />);
      });

      // Every plan is offered as a fresh subscription, none is "current".
      assert.equal(
        rendered?.getAllByRole("button", { name: "Subscribe" }).length,
        3
      );

      await act(() => {
        const proCard = rendered
          ?.getByRole("heading", { name: "Pro" })
          .closest("article");
        const subscribePro =
          proCard == null
            ? null
            : within(proCard).getByRole("button", {
                name: "Subscribe",
              });
        if (subscribePro != null) {
          fireEvent.click(subscribePro);
        }
      });

      const text = rendered?.baseElement.textContent ?? "";
      assert.ok(text.includes("Order summary"));
      assert.ok(text.includes("$20.00"));
      assert.deepEqual(quoteOperators, ["created"]);

      await act(() => {
        const confirm = rendered?.getByRole("button", {
          name: "Subscribe & Pay",
        });
        if (confirm != null) {
          fireEvent.click(confirm);
        }
      });
      assert.deepEqual(paymentOperators, ["created"]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});
