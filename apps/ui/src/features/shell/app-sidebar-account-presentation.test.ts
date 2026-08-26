import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";
import { deriveAppSidebarAccountPresentation } from "./app-sidebar-account-presentation";

const NOW = new Date("2026-08-25T12:00:00Z");

function summary(
  overrides: Partial<WorkspaceSubscriptionSummary>
): WorkspaceSubscriptionSummary {
  return {
    currentPeriodEndAt: "2026-09-12T12:00:00Z",
    isActiveFreeTrial: false,
    isPayg: false,
    lifecycle: "active",
    planName: "PRO",
    ...overrides,
  };
}

test("an active paid plan shows its badge and stays quiet", () => {
  assert.deepEqual(deriveAppSidebarAccountPresentation(summary({}), NOW), {
    badge: { kind: "plan", planName: "PRO" },
    hint: null,
  });
});

test("a missing summary yields neither badge nor hint", () => {
  assert.deepEqual(deriveAppSidebarAccountPresentation(null, NOW), {
    badge: null,
    hint: null,
  });
});

test("a Pay-As-You-Go workspace fills the badge slot with PAYG", () => {
  assert.deepEqual(
    deriveAppSidebarAccountPresentation(
      summary({ isPayg: true, planName: "PAYG" }),
      NOW
    ),
    { badge: { kind: "payg" }, hint: null }
  );
});

test("an Active Free Trial counts the days it has left", () => {
  const presentation = deriveAppSidebarAccountPresentation(
    summary({
      currentPeriodEndAt: "2026-08-28T12:00:00Z",
      isActiveFreeTrial: true,
      planName: "Free",
    }),
    NOW
  );
  assert.deepEqual(presentation.hint, {
    text: "Trial · 3 days left",
    tone: "warn",
  });
  assert.deepEqual(presentation.badge, { kind: "plan", planName: "Free" });
});

test("an Active Free Trial with one day left speaks in the singular", () => {
  const presentation = deriveAppSidebarAccountPresentation(
    summary({
      currentPeriodEndAt: "2026-08-26T06:00:00Z",
      isActiveFreeTrial: true,
      planName: "Free",
    }),
    NOW
  );
  assert.equal(presentation.hint?.text, "Trial · 1 day left");
});

test("a cancelling subscription announces its end date", () => {
  const presentation = deriveAppSidebarAccountPresentation(
    summary({ lifecycle: "cancelling" }),
    NOW
  );
  assert.deepEqual(presentation.hint, { text: "Ends Sep 12", tone: "warn" });
});

test("a cancelling subscription without a parsable end date stays quiet", () => {
  const presentation = deriveAppSidebarAccountPresentation(
    summary({ currentPeriodEndAt: "", lifecycle: "cancelling" }),
    NOW
  );
  assert.equal(presentation.hint, null);
});

test("a payment-due subscription warns in the danger tone", () => {
  const presentation = deriveAppSidebarAccountPresentation(
    summary({ lifecycle: "payment-due" }),
    NOW
  );
  assert.deepEqual(presentation.hint, {
    text: "Payment due · service limited",
    tone: "danger",
  });
});

test("a blank plan name drops the badge but keeps the hint", () => {
  const presentation = deriveAppSidebarAccountPresentation(
    summary({ lifecycle: "payment-due", planName: " " }),
    NOW
  );
  assert.equal(presentation.badge, null);
  assert.equal(presentation.hint?.tone, "danger");
});
