import assert from "node:assert/strict";
import { test } from "node:test";

import { render } from "@testing-library/react/pure";

import { withTestDom } from "@/features/project-canvas/react-test-harness";

import type { StatusHint } from "./status-hint-model";

const PAYMENT_DUE: StatusHint = {
  cta: { href: "/billing", label: "Renew plan" },
  description:
    "This workspace is suspended. Resources will be deleted on Sep 6 unless the subscription is renewed.",
  dismissible: false,
  id: "payment-due",
  title: "Workspace suspended — payment due",
  tone: "destructive",
};

const QUOTA_FULL: StatusHint = {
  cta: { href: "/billing/usage", label: "View usage" },
  description:
    "Deployments requesting more storage will fail until it is freed or the plan is upgraded.",
  dismissible: true,
  id: "quota-full",
  title: "Storage quota is full",
  tone: "warning",
};

async function renderHint(
  hint: StatusHint,
  run: (
    rendered: ReturnType<typeof render>,
    dismissals: () => number,
    act: (run: () => void) => Promise<void>
  ) => void | Promise<void>
) {
  await withTestDom(async (act) => {
    const { StatusHintBannerView } = await import("./status-hint-banner");
    let rendered: ReturnType<typeof render> | undefined;
    let dismissed = 0;
    try {
      await act(() => {
        rendered = render(
          <StatusHintBannerView
            hint={hint}
            onDismiss={() => {
              dismissed += 1;
            }}
          />
        );
      });
      if (rendered != null) {
        await run(rendered, () => dismissed, act);
      }
    } finally {
      await act(() => rendered?.unmount());
    }
  });
}

test("a non-dismissible hint renders title, description, and CTA with no close button", async () => {
  await renderHint(PAYMENT_DUE, (rendered) => {
    // A destructive, non-dismissible state announces itself as an alert.
    const banner = rendered.getByRole("alert");
    assert.equal(banner.dataset.state, "payment-due");
    assert.equal(banner.dataset.tone, "destructive");
    const text = banner.textContent ?? "";
    assert.ok(text.includes("Workspace suspended — payment due"));
    assert.ok(text.includes("Resources will be deleted on Sep 6"));
    const cta = rendered.getByRole("button", { name: "Renew plan" });
    assert.equal(cta.getAttribute("href"), "/billing");
    assert.equal(rendered.queryByRole("button", { name: "Dismiss" }), null);
  });
});

test("a dismissible hint pins a close button that reports the dismissal", async () => {
  await renderHint(QUOTA_FULL, async (rendered, dismissals, act) => {
    assert.equal(rendered.getByRole("status").dataset.state, "quota-full");
    const close = rendered.getByRole("button", { name: "Dismiss" });
    await act(() => close.click());
    assert.equal(dismissals(), 1);
    assert.equal(
      rendered.getByRole("button", { name: "View usage" }).getAttribute("href"),
      "/billing/usage"
    );
  });
});

test("the CTA records the billing return route before navigating", async () => {
  await renderHint(QUOTA_FULL, async (rendered, _dismissals, act) => {
    window.history.replaceState({}, "", "/project/demo?tab=canvas");
    window.sessionStorage.removeItem("billing-return-route");
    const cta = rendered.getByRole("button", { name: "View usage" });
    await act(() => {
      cta.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    assert.equal(
      window.sessionStorage.getItem("billing-return-route"),
      "/project/demo?tab=canvas"
    );
  });
});
