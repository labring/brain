import assert from "node:assert/strict";
import { test } from "node:test";

import { render } from "@testing-library/react/pure";

import { withTestDom } from "@/features/project-canvas/react-test-harness";
import { loadBillingPlanSnapshot } from "./billing-plan-data";
import { scenarioTestFetch } from "./server/dev-fixtures/scenario-test-fetch";

/**
 * Renders the Plan surface for the dev-mock scenarios whose whole point is
 * "which actions remain": each test pins what the user sees TODAY, including
 * behavior other issues in the hardening project intend to change — landing
 * such a fix means editing the matching assertion here, which keeps the
 * behavior change visible in the diff.
 */

const DELETED_BADGE_PATTERN = /Deleted/;
const DELETED_NOTICE_PATTERN = /Subscription ended/;
const UNAVAILABLE_BADGE_PATTERN = /Status unavailable/;
const UNAVAILABLE_NOTICE_PATTERN = /Subscription status unavailable/;
const UNAVAILABLE_LOCKED_PATTERN =
  /Plan changes are disabled until the subscription status can be confirmed/;
const DELETION_WARNING_TITLE_PATTERN = /Workspace scheduled for deletion/;
const DELETION_WARNING_FUTURE_TENSE_PATTERN =
  /All resources will be permanently deleted after/;
const PAYG_HEADING_PATTERN = /Pay-As-You-Go/;
const EXPIRED_WARNING_TITLE_PATTERN = /Your subscription has expired/;
const UNDATED_GRACE_FALLBACK_PATTERN = /the grace period ends/;

const CREDENTIALS = {
  appToken: "test-token",
  kubeconfig: "test-kubeconfig",
  workspace: "ns-test",
};

function loadSnapshotForScenario(scenario: string) {
  return loadBillingPlanSnapshot(CREDENTIALS, {
    fetch: scenarioTestFetch(scenario),
  });
}

async function renderScenario(
  scenario: string,
  run: (rendered: ReturnType<typeof render>) => void | Promise<void>
) {
  const snapshot = await loadSnapshotForScenario(scenario);
  await withTestDom(async (act) => {
    const { BillingPlanSurface } = await import("./billing-plan-surface");
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(
          <BillingPlanSurface
            balance={<span>$1.00</span>}
            currency="usd"
            onLifecycleAction={() => undefined}
            onPlanChange={() => undefined}
            snapshot={snapshot}
          />
        );
      });
      if (rendered != null) {
        await run(rendered);
      }
    } finally {
      await act(() => rendered?.unmount());
    }
  });
}

test("deleted renders the subscribable-again PAYG surface", async () => {
  // AIM-252: a DELETED record is not a Workspace Subscription — the surface
  // presents the plain PAYG state with a working Subscribe entry point.
  await renderScenario("deleted", (rendered) => {
    const text = rendered.container.textContent ?? "";
    assert.match(text, PAYG_HEADING_PATTERN);
    assert.doesNotMatch(text, DELETED_BADGE_PATTERN);
    assert.doesNotMatch(text, DELETED_NOTICE_PATTERN);
    assert.ok(rendered.queryByRole("button", { name: "Subscribe Plan" }));
    assert.equal(rendered.queryByRole("button", { name: "Cancel Plan" }), null);
  });
});

test("status-unknown renders the unavailable notice and offers no actions", async () => {
  await renderScenario("status-unknown", (rendered) => {
    const text = rendered.container.textContent ?? "";
    assert.match(text, UNAVAILABLE_BADGE_PATTERN);
    // AIM-260 baseline: the copy implies a transient outage with no way out.
    assert.match(text, UNAVAILABLE_NOTICE_PATTERN);
    assert.match(text, UNAVAILABLE_LOCKED_PATTERN);
    assert.equal(
      rendered.queryByRole("button", { name: "Upgrade Plan" }),
      null
    );
    assert.equal(rendered.queryByRole("button", { name: "Cancel Plan" }), null);
  });
});

test("payment-due-final keeps the deletion warning and the Renew action", async () => {
  await renderScenario("payment-due-final", (rendered) => {
    const text = rendered.container.textContent ?? "";
    assert.match(text, DELETION_WARNING_TITLE_PATTERN);
    // AIM-258 baseline: the copy stays future-tense although the derived
    // deletion date is already in the past in the final stage.
    assert.match(text, DELETION_WARNING_FUTURE_TENSE_PATTERN);
    assert.ok(rendered.queryByRole("button", { name: "Renew" }));
  });
});

test("payg-debt keeps the Subscribe action under a subscription-worded banner", async () => {
  await renderScenario("payg-debt", (rendered) => {
    const text = rendered.container.textContent ?? "";
    assert.match(text, PAYG_HEADING_PATTERN);
    // AIM-257 baseline: the banner claims an expired subscription (there is
    // none) and falls back to the undated grace-period wording.
    assert.match(text, EXPIRED_WARNING_TITLE_PATTERN);
    assert.match(text, UNDATED_GRACE_FALLBACK_PATTERN);
    assert.ok(rendered.queryByRole("button", { name: "Subscribe Plan" }));
  });
});

// AIM-255: the header's Renewal Time reads the same period-end field as the
// workspaces table, and blanks under the same no-renewal states.
function headerRenewalTime(
  rendered: Parameters<Parameters<typeof renderScenario>[1]>[0]
): string | null {
  const label = Array.from(rendered.container.querySelectorAll("dt")).find(
    (node) => node.textContent === "Renewal Time"
  );
  return label?.nextElementSibling?.textContent ?? null;
}

test("active renders the period end as the header Renewal Time", async () => {
  await renderScenario("active", (rendered) => {
    const value = headerRenewalTime(rendered);
    assert.ok(
      value != null && value !== "-",
      "the header Renewal Time carries the period-end date"
    );
  });
});

test("cancelling blanks the header Renewal Time like the workspaces table", async () => {
  await renderScenario("cancelling", (rendered) => {
    assert.equal(headerRenewalTime(rendered), "-");
  });
});

test("paused blanks the header Renewal Time without a running period", async () => {
  await renderScenario("paused", (rendered) => {
    assert.equal(headerRenewalTime(rendered), "-");
  });
});
