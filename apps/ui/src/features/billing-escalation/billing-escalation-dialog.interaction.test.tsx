import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render } from "@testing-library/react/pure";

import { TOP_UP_DESKTOP } from "@/features/billing/billing-cta";
import { withTestDom } from "@/features/project-canvas/react-test-harness";

import type { BillingEscalationStage } from "./billing-escalation-model";

/**
 * The dialog as the user meets it: named by its title, described by its
 * body, and closed — exactly once — by Dismiss, the fix, Esc, or the
 * backdrop. Rendered with a stage, never through the feed.
 */

const PAYMENT_DUE: BillingEscalationStage = {
  body: [
    {
      emphasis: false,
      text: "The subscription has expired and this workspace is suspended. Resources will be deleted on ",
    },
    { emphasis: true, text: "Sep 17" },
    { emphasis: false, text: " unless you renew." },
  ],
  fix: { href: "/billing", label: "Renew plan" },
  ladder: "workspace",
  title: "Workspace suspended — payment due",
};

const ACCOUNT_DEBT: BillingEscalationStage = {
  body: [
    {
      emphasis: false,
      text: "Pay-as-you-go workspaces are suspended. Top up your balance to restore them.",
    },
  ],
  fix: { desktop: TOP_UP_DESKTOP, href: "/billing", label: "Top up balance" },
  ladder: "account",
  title: "Account balance in debt",
};

async function renderStage(
  stage: BillingEscalationStage,
  run: (
    rendered: ReturnType<typeof render>,
    dismissals: () => number,
    act: (run: () => void) => Promise<void>
  ) => void | Promise<void>
) {
  await withTestDom(async (act) => {
    const { BillingEscalationDialogView } = await import(
      "./billing-escalation-dialog"
    );
    let rendered: ReturnType<typeof render> | undefined;
    let dismissed = 0;
    try {
      await act(() => {
        rendered = render(
          <BillingEscalationDialogView
            onDismiss={() => {
              dismissed += 1;
            }}
            open
            stage={stage}
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

test("the dialog is named by the stage's title and described by its body, with the date set off", async () => {
  await renderStage(PAYMENT_DUE, (rendered) => {
    const dialog = rendered.getByRole("dialog", {
      name: "Workspace suspended — payment due",
    });
    assert.equal(dialog.dataset.ladder, "workspace");
    const describedBy = dialog.getAttribute("aria-describedby");
    assert.ok(describedBy, "the body is the dialog's description");
    const description = document.getElementById(describedBy);
    assert.equal(
      description?.textContent,
      "The subscription has expired and this workspace is suspended. Resources will be deleted on Sep 17 unless you renew."
    );
    const date = description?.querySelector("span");
    assert.equal(date?.textContent, "Sep 17");
    assert.ok(date?.className.includes("font-medium"));
    assert.ok(date?.className.includes("text-foreground"));
    // No close-X: Brain dialogs put their way out in the footer.
    assert.equal(rendered.queryByRole("button", { name: "Close" }), null);
  });
});

test("Dismiss fires the dismissal exactly once", async () => {
  await renderStage(PAYMENT_DUE, async (rendered, dismissals, act) => {
    await act(() => {
      fireEvent.click(rendered.getByRole("button", { name: "Dismiss" }));
    });
    assert.equal(dismissals(), 1);
  });
});

test("the fix records the billing return route and dismisses exactly once", async () => {
  await renderStage(PAYMENT_DUE, async (rendered, dismissals, act) => {
    window.history.replaceState({}, "", "/project/demo?tab=canvas");
    window.sessionStorage.removeItem("billing-return-route");
    const fix = rendered.getByRole("button", { name: "Renew plan" });
    assert.equal(fix.getAttribute("href"), "/billing");
    await act(() => {
      fix.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    assert.equal(dismissals(), 1);
    assert.equal(
      window.sessionStorage.getItem("billing-return-route"),
      "/project/demo?tab=canvas"
    );
  });
});

test("Escape dismisses exactly once", async () => {
  await renderStage(PAYMENT_DUE, async (rendered, dismissals, act) => {
    await act(() => {
      fireEvent.keyDown(rendered.getByRole("dialog"), { key: "Escape" });
    });
    assert.equal(dismissals(), 1);
  });
});

test("the backdrop dismisses exactly once", async () => {
  await renderStage(PAYMENT_DUE, async (_rendered, dismissals, act) => {
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    assert.ok(overlay, "the dialog is modal");
    await act(() => {
      fireEvent.pointerDown(overlay);
      fireEvent.mouseDown(overlay);
      fireEvent.pointerUp(overlay);
      fireEvent.mouseUp(overlay);
      fireEvent.click(overlay);
    });
    assert.equal(dismissals(), 1);
  });
});

test("the close-complete callback fires once, only after the closed dialog has left", async () => {
  await withTestDom(async (act) => {
    const { BillingEscalationDialogView } = await import(
      "./billing-escalation-dialog"
    );
    let completed = 0;
    const view = (open: boolean) => (
      <BillingEscalationDialogView
        onCloseComplete={() => {
          completed += 1;
        }}
        onDismiss={() => {
          // The close is driven from outside here.
        }}
        open={open}
        stage={PAYMENT_DUE}
      />
    );
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(view(true));
      });
      rendered?.getByRole("dialog");
      assert.equal(completed, 0, "opening completes nothing");
      await act(() => rendered?.rerender(view(false)));
      assert.equal(rendered?.queryByRole("dialog"), null);
      assert.equal(completed, 1);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("an account stage's fix falls back to the Billing Area while the Desktop link is unresolved", async () => {
  await renderStage(ACCOUNT_DEBT, (rendered) => {
    rendered.getByRole("dialog", { name: "Account balance in debt" });
    const fix = rendered.getByRole("button", { name: "Top up balance" });
    assert.equal(fix.getAttribute("href"), "/billing");
    assert.equal(fix.getAttribute("target"), null);
  });
});
