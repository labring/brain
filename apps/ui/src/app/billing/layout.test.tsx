import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactNode } from "react";

mock.module("server-only", () => ({}));

const {
  default: AuthBootstrap,
  DevboxBootstrap,
  SealosSdkBootstrap,
} = await import("@/features/shell/auth-bootstrap");
const { default: ProjectWorkspaceLayout } = await import(
  "@/features/shell/project-workspace-layout"
);
const { default: BillingTabShell } = await import(
  "@/features/billing/billing-tab-shell"
);
const { BillingEscalationDialog } = await import(
  "@/features/billing-escalation/billing-escalation-dialog"
);
const { StatusHintBanner } = await import(
  "@/features/status-hint/status-hint-banner"
);
const { default: BillingLayout } = await import("./layout");

function mountedComponents(
  node: ReactNode,
  found: Set<unknown> = new Set()
): Set<unknown> {
  if (Array.isArray(node)) {
    for (const child of node) {
      mountedComponents(child, found);
    }
    return found;
  }
  if (!isValidElement(node)) {
    return found;
  }
  found.add(node.type);
  return mountedComponents(
    (node.props as { children?: ReactNode }).children,
    found
  );
}

test("billing layout keeps one tab shell and shared auth chrome across tabs", () => {
  const mounted = mountedComponents(BillingLayout({ children: null }));

  assert.ok(mounted.has(AuthBootstrap), "AuthBootstrap is mounted");
  assert.ok(mounted.has(SealosSdkBootstrap), "SealosSdkBootstrap is mounted");
  assert.ok(mounted.has(BillingTabShell), "BillingTabShell is mounted");
  assert.equal(
    mounted.has(DevboxBootstrap),
    false,
    "DevboxBootstrap is absent"
  );
  assert.equal(
    mounted.has(ProjectWorkspaceLayout),
    false,
    "ProjectWorkspaceLayout is absent"
  );
});

// The Billing Area announces a debt stage where the user already is
// (AIM-348, story 15); an unmounted dialog silently drops that.
test("billing layout mounts the Billing Escalation Dialog beside the Status Hint", () => {
  const mounted = mountedComponents(BillingLayout({ children: null }));

  assert.ok(mounted.has(StatusHintBanner), "StatusHintBanner is mounted");
  assert.ok(
    mounted.has(BillingEscalationDialog),
    "BillingEscalationDialog is mounted"
  );
});
