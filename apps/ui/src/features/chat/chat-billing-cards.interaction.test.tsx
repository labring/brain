import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render } from "@testing-library/react/pure";

import { withTestDom } from "@/features/project-canvas/react-test-harness";

import type { FreeTierState } from "./persistence/types";

const TRIAL_MID: FreeTierState = { billing: "free", limit: 5, remaining: 3 };
const TRIAL_LAST: FreeTierState = { billing: "free", limit: 5, remaining: 1 };
const BLOCKED: FreeTierState = { billing: "blocked", limit: 5, remaining: 0 };
const USER: FreeTierState = { billing: "user", limit: 5, remaining: 0 };

async function cardModules() {
  return await import("./chat-billing-cards");
}

test("card arbitration is blocked > error > counter, nothing on user billing", async () => {
  const { resolveChatBillingCard } = await cardModules();

  assert.equal(
    resolveChatBillingCard({ billing: "blocked", errored: true }),
    "blocked"
  );
  assert.equal(
    resolveChatBillingCard({ billing: "free", errored: true }),
    "error"
  );
  assert.equal(
    resolveChatBillingCard({ billing: "free", errored: false }),
    "counter"
  );
  assert.equal(
    resolveChatBillingCard({ billing: "user", errored: true }),
    "error"
  );
  assert.equal(
    resolveChatBillingCard({ billing: "user", errored: false }),
    null
  );
  assert.equal(resolveChatBillingCard({ billing: null, errored: false }), null);
});

test("counter card keeps identical wording at every remaining count and links to plans", async () => {
  await withTestDom(async (act) => {
    const { ChatBillingCardSlot } = await cardModules();
    const navigations: number[] = [];
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <ChatBillingCardSlot
            errored={false}
            freeTier={TRIAL_MID}
            onNavigateToBilling={() => navigations.push(1)}
          />
        );
      });
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("3 of 5 free messages left"));
      assert.ok(
        rendered?.getByRole("progressbar", { name: "Free messages remaining" })
      );

      await act(() => {
        rendered?.rerender(
          <ChatBillingCardSlot
            errored={false}
            freeTier={TRIAL_LAST}
            onNavigateToBilling={() => navigations.push(1)}
          />
        );
      });
      // The last count keeps the exact same sentence shape — informed, not
      // alarmed (user story 3).
      const lastText = rendered?.container.textContent ?? "";
      assert.ok(lastText.includes("1 of 5 free messages left"));
      assert.equal(lastText.includes("Last"), false);

      const viewPlans = rendered?.getByRole("button", { name: "View plans" });
      assert.ok(viewPlans);
      fireEvent.click(viewPlans as HTMLElement);
      assert.deepEqual(navigations, [1]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("blocked card carries the upgrade CTA and outranks an error", async () => {
  await withTestDom(async (act) => {
    const { ChatBillingCardSlot } = await cardModules();
    const navigations: number[] = [];
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <ChatBillingCardSlot
            errored
            freeTier={BLOCKED}
            onNavigateToBilling={() => navigations.push(1)}
          />
        );
      });
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("Free messages used up"));
      assert.ok(text.includes("Upgrade to keep chatting with the assistant."));
      // The error card lost the arbitration: "try again" would be a lie.
      assert.equal(text.includes("Message not sent"), false);

      const upgrade = rendered?.getByRole("button", { name: "Upgrade plan" });
      assert.ok(upgrade);
      fireEvent.click(upgrade as HTMLElement);
      assert.deepEqual(navigations, [1]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("error card announces as an alert and carries zero billing markings", async () => {
  await withTestDom(async (act) => {
    const { ChatBillingCardSlot } = await cardModules();
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <ChatBillingCardSlot
            errored
            freeTier={USER}
            onNavigateToBilling={() => undefined}
          />
        );
      });
      const alert = rendered?.getByRole("alert");
      assert.ok(alert);
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("Message not sent"));
      assert.ok(
        text.includes("Something went wrong on our side. Try sending it again.")
      );
      assert.equal(text.includes("free"), false);
      assert.equal(text.includes("Upgrade"), false);
      assert.equal(text.includes("plan"), false);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("error card replaces the counter card on a trial (one card at a time)", async () => {
  await withTestDom(async (act) => {
    const { ChatBillingCardSlot } = await cardModules();
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <ChatBillingCardSlot
            errored
            freeTier={TRIAL_MID}
            onNavigateToBilling={() => undefined}
          />
        );
      });
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("Message not sent"));
      assert.equal(text.includes("free messages left"), false);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("steady-state user billing renders no card at all", async () => {
  await withTestDom(async (act) => {
    const { ChatBillingCardSlot } = await cardModules();
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <ChatBillingCardSlot
            errored={false}
            freeTier={USER}
            onNavigateToBilling={() => undefined}
          />
        );
      });
      assert.equal(rendered?.container.textContent, "");
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});
