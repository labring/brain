import { PlanBadge } from "@workspace/ui/components/plan-badge";

import type { SessionWorkspace } from "@/features/session/session-schema";

/** "Personal" for the Personal Workspace, otherwise the user's Workspace Role. */
export function workspaceRoleLabel(workspace: SessionWorkspace): string {
  return workspace.isPersonal ? "Personal" : workspace.role;
}

/**
 * The plan of a Workspace's subscription as the Switcher and the Workspace
 * Area show it: the tier badge for a plan, the quiet PAYG word for a
 * Workspace without a subscription (null), nothing while the plan is
 * unknown (undefined — still loading, or the plans route failed).
 */
export function PlanSlot({
  className,
  planName,
}: {
  className?: string;
  planName: string | null | undefined;
}) {
  if (planName === undefined) {
    return null;
  }
  if (planName === null) {
    return (
      <span className="text-muted-foreground text-xs" data-slot="plan-payg">
        PAYG
      </span>
    );
  }
  return <PlanBadge className={className} planName={planName} />;
}

/** The plan for one Workspace from the plans record; undefined when unknown. */
export function planNameFor(
  plans: Record<string, string | null> | undefined,
  workspaceId: string
): string | null | undefined {
  if (plans == null || !(workspaceId in plans)) {
    return undefined;
  }
  return plans[workspaceId] ?? null;
}
