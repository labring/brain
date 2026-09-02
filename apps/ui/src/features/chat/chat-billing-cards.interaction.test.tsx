import assert from "node:assert/strict";
import { test } from "node:test";

import { fireEvent, render } from "@testing-library/react/pure";

import { withTestDom } from "@/features/project-canvas/react-test-harness";

import type { FreeTierState } from "./persistence/types";

const TRIAL_MID: FreeTierState = { billing: "free", limit: 5, remaining: 3 };
const TRIAL_LAST: FreeTierState = { billing: "free", limit: 5, remaining: 1 };
const USER: FreeTierState = { billing: "user", limit: 5, remaining: 0 };

async function cardModules() {
  return await import("./chat-billing-cards");
}

test("card arbitration is wall > billing-error > error > counter, nothing on open user billing", async () => {
  const { resolveChatBillingCard } = await cardModules();

  assert.equal(
    resolveChatBillingCard({
      billing: "user",
      errored: true,
      interruption: { paidSource: "balance" },
      wall: "balance",
    }),
    "wall"
  );
  assert.equal(
    resolveChatBillingCard({
      billing: "user",
      errored: true,
      interruption: { paidSource: "ai-credits" },
      wall: null,
    }),
    "billing-error"
  );
  assert.equal(
    resolveChatBillingCard({
      billing: "user",
      errored: false,
      interruption: { paidSource: "ai-credits" },
      wall: null,
    }),
    null
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
    const navigations: string[] = [];
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <ChatBillingCardSlot
            errored={false}
            freeTier={TRIAL_MID}
            onNavigateToBilling={(destination) => navigations.push(destination)}
          />
        );
      });
      const text = rendered?.container.textContent ?? "";
      assert.ok(text.includes("3 of 5 free trial messages left"));
      assert.ok(
        rendered?.getByRole("progressbar", {
          name: "Free trial messages remaining",
        })
      );

      await act(() => {
        rendered?.rerender(
          <ChatBillingCardSlot
            errored={false}
            freeTier={TRIAL_LAST}
            onNavigateToBilling={(destination) => navigations.push(destination)}
          />
        );
      });
      // The last count keeps the exact same sentence shape — informed, not
      // alarmed (user story 3).
      const lastText = rendered?.container.textContent ?? "";
      assert.ok(lastText.includes("1 of 5 free trial messages left"));
      assert.equal(lastText.includes("Last"), false);

      const viewPlans = rendered?.getByRole("button", { name: "View plans" });
      assert.ok(viewPlans);
      fireEvent.click(viewPlans as HTMLElement);
      // "View plans" lands on the Plan view without deep-linking the picker.
      assert.deepEqual(navigations, ["plans"]);
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
      assert.equal(text.includes("free trial messages left"), false);
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

test("paid wall card speaks the exhausted source loudly and links to its fix", async () => {
  await withTestDom(async (act) => {
    const { ChatBillingCardSlot } = await cardModules();
    const navigations: string[] = [];
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <ChatBillingCardSlot
            errored={false}
            freeTier={{ ...USER, paidSource: "ai-credits", wall: "ai-credits" }}
            onNavigateToBilling={(destination) => navigations.push(destination)}
          />
        );
      });
      const wall = rendered?.container.querySelector(
        '[data-slot="chat-paid-wall-card"]'
      );
      assert.ok(wall, "the wall card renders");
      const text = wall?.textContent ?? "";
      assert.ok(text.includes("AI Credits used up"));
      const upgrade = rendered?.getByRole("button", { name: "Upgrade plan" });
      fireEvent.click(upgrade as HTMLElement);
      assert.deepEqual(navigations, ["upgrade"]);

      await act(() => {
        rendered?.rerender(
          <ChatBillingCardSlot
            errored={false}
            freeTier={{ ...USER, paidSource: "balance", wall: "balance" }}
            onNavigateToBilling={(destination) => navigations.push(destination)}
          />
        );
      });
      const paygText = rendered?.container.textContent ?? "";
      assert.ok(paygText.includes("Account balance in debt"));
      const topUp = rendered?.getByRole("button", { name: "Top up balance" });
      fireEvent.click(topUp as HTMLElement);
      assert.deepEqual(navigations, ["upgrade", "top-up"]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("allowance wall card names the missing allowance, not a Paid Source, and links to upgrade (ADR-0073)", async () => {
  await withTestDom(async (act) => {
    const { ChatBillingCardSlot } = await cardModules();
    const navigations: string[] = [];
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <ChatBillingCardSlot
            errored={false}
            freeTier={{
              ...USER,
              paidSource: "ai-credits",
              wall: "allowance-trial",
            }}
            onNavigateToBilling={(destination) => navigations.push(destination)}
          />
        );
      });
      const wall = rendered?.container.querySelector(
        '[data-slot="chat-paid-wall-card"]'
      );
      assert.ok(wall, "the wall card renders for the trial voice");
      const trialText = wall?.textContent ?? "";
      assert.ok(trialText.includes("Free trial messages used up"));
      assert.ok(
        !trialText.includes("AI Credits"),
        "a workspace that never held AI Credits is not told they ran out"
      );
      fireEvent.click(
        rendered?.getByRole("button", { name: "Upgrade plan" }) as HTMLElement
      );
      assert.deepEqual(navigations, ["upgrade"]);

      await act(() => {
        rendered?.rerender(
          <ChatBillingCardSlot
            errored={false}
            freeTier={{
              ...USER,
              paidSource: "ai-credits",
              wall: "allowance-plan",
            }}
            onNavigateToBilling={(destination) => navigations.push(destination)}
          />
        );
      });
      const planText = rendered?.container.textContent ?? "";
      assert.ok(planText.includes("AI usage not included"));
      assert.ok(!planText.includes("Free trial"));
      fireEvent.click(
        rendered?.getByRole("button", { name: "Upgrade plan" }) as HTMLElement
      );
      assert.deepEqual(navigations, ["upgrade", "upgrade"]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});

test("a billing interruption turns the error card truthful without locking anything", async () => {
  await withTestDom(async (act) => {
    const { ChatBillingCardSlot } = await cardModules();
    const navigations: string[] = [];
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <ChatBillingCardSlot
            errored
            freeTier={{ ...USER, paidSource: "balance", wall: null }}
            interruption={{ paidSource: "balance" }}
            onNavigateToBilling={(destination) => navigations.push(destination)}
          />
        );
      });
      const card = rendered?.container.querySelector(
        '[data-slot="chat-billing-error-card"]'
      );
      assert.ok(card, "the billing-ized error card renders");
      const text = card?.textContent ?? "";
      assert.ok(text.includes("Message not sent — account balance in debt"));
      assert.equal(text.includes("Something went wrong on our side"), false);
      const topUp = rendered?.getByRole("button", { name: "Top up balance" });
      fireEvent.click(topUp as HTMLElement);
      assert.deepEqual(navigations, ["top-up"]);
    } finally {
      await act(() => rendered?.unmount());
    }
  });
});
