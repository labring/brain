import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { fireEvent, render } from "@testing-library/react/pure";
import type { NotificationCRItem } from "@workspace/api/hooks";
import { createStore, Provider } from "jotai";

import { platformNotification } from "@/features/notifications/feed-model";
import { withTestDom } from "@/features/project-canvas/react-test-harness";
import type { AppNotification } from "@/features/shell/app-sidebar-notifications-model";
import type { StatusHintInputs } from "@/features/status-hint/status-hint-model";

import { billingEscalationOpenAtom } from "./billing-escalation-store";

/**
 * The connected dialog over a scripted feed: it opens for the newest unread
 * rung and publishes that fact, one dismissal dispatches the announced rung
 * with its superseded set, the optimistic read closes it and lowers the
 * published state only once it has left, and a rolled-back receipt brings
 * it back. The feed and the standing inputs are stubbed; the model, the
 * view, and the atom are real.
 */

const T0 = 1_756_800_000; // Unix seconds
const NO_RECEIPTS: ReadonlySet<string> = new Set();

function cr(name: string, timestamp: number): NotificationCRItem {
  return {
    desktopPopup: true,
    from: "Workspace-Subscription-System",
    importance: "High",
    isRead: false,
    message: `upstream body for ${name}`,
    name,
    namespace: "ns-a",
    timestamp,
    title: `upstream title for ${name}`,
    version: timestamp,
  };
}

const suspended = platformNotification(
  cr("workspace-debt-debt", T0),
  NO_RECEIPTS
);
const approaching = platformNotification(
  cr("workspace-debt-debtpredeletion", T0 + 7 * 86_400),
  NO_RECEIPTS
);

const dispatched: string[][] = [];
const feed: {
  items: readonly AppNotification[];
  markManyRead: (items: readonly AppNotification[]) => void;
  readIds: ReadonlySet<string>;
} = {
  items: [suspended, approaching],
  markManyRead: (items) => {
    dispatched.push(items.map((item) => item.id));
  },
  readIds: NO_RECEIPTS,
};

// A subscribed workspace in good account standing: the workspace ladder
// stands on its own, and nothing here is Account Debt.
const INPUTS: StatusHintInputs = {
  availableBalanceMicroUnits: 5_000_000,
  lifetimeDeductionMicroUnits: 1_000_000,
  now: new Date(T0 * 1000),
  quota: null,
  subscription: null,
};

mock.module("@/features/notifications/use-notification-feed", () => ({
  useNotificationFeed: () => feed,
}));

mock.module("@/features/status-hint/use-status-hint-inputs", () => ({
  useStatusHintInputs: () => INPUTS,
}));

mock.module("@/features/billing-escalation/billing-escalation-tweaks", () => ({
  useBillingEscalationForce: () => null,
}));

test("the connected dialog announces the newest rung, dismisses its ladder in one dispatch, and publishes its open state until it has left", async () => {
  const store = createStore();
  await withTestDom(async (act) => {
    const { BillingEscalationDialog } = await import(
      "./billing-escalation-dialog"
    );
    const tree = () => (
      <Provider store={store}>
        <BillingEscalationDialog />
      </Provider>
    );
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(tree());
      });
      assert.ok(rendered);
      const mounted = rendered;

      // Opens for the newest rung; the older one is not what it announces.
      mounted.getByRole("dialog", { name: "Workspace deletion approaching" });
      assert.equal(store.get(billingEscalationOpenAtom), true);

      // One dismissal, one dispatch: the announced rung and its superseded
      // set. The dialog itself stays until the read lands — read state is
      // its only memory.
      await act(() => {
        fireEvent.click(mounted.getByRole("button", { name: "Dismiss" }));
      });
      assert.deepEqual(dispatched, [[approaching.id, suspended.id]]);
      mounted.getByRole("dialog", { name: "Workspace deletion approaching" });

      // The optimistic read lands: the dialog closes and, once it has left,
      // the Onboarding Gate is told so.
      feed.readIds = new Set(dispatched[0]);
      await act(() => mounted.rerender(tree()));
      assert.equal(mounted.queryByRole("dialog"), null);
      assert.equal(store.get(billingEscalationOpenAtom), false);

      // The receipt failed and rolled back: the dialog returns, as intended.
      feed.readIds = NO_RECEIPTS;
      await act(() => mounted.rerender(tree()));
      mounted.getByRole("dialog", { name: "Workspace deletion approaching" });
      assert.equal(store.get(billingEscalationOpenAtom), true);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
  // Unmounting lowers the published state whatever it was.
  assert.equal(store.get(billingEscalationOpenAtom), false);
});
