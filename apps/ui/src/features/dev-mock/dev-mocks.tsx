"use client";

import { BillingDevMockTweaks } from "@/features/billing/billing-dev-mock";
import { ChatDevMockTweaks } from "@/features/chat/dev-mock";
import { DeployTaskDevMockTweaks } from "@/features/deploy/task/dev-mock";
import { NotificationsDevMockTweaks } from "@/features/notifications/dev-mock";
import { ProjectsExplorerDevMock } from "@/features/projects/explorer/projects-dev-mock";

/**
 * The app-global Dev Mock registry: every Dev Mock registers here, once, next
 * to the dev tweaks panel — never from the routes it affects. A Dev Mock's
 * cookie is path-global, so the mock can be serving fixtures on any route;
 * the panel must show it (and the Launcher must count it as dirty) wherever
 * the user is, or an enabled mock becomes invisible and unswitchable.
 *
 * Mounted inside `DevTweaksEnabled`, so the same compile-time gate that
 * tree-shakes the panel out of real production builds drops the registry and
 * every fixture-adjacent client module with it.
 */
export function DevMocks() {
  return (
    <>
      <BillingDevMockTweaks />
      <NotificationsDevMockTweaks />
      <ChatDevMockTweaks />
      <DeployTaskDevMockTweaks />
      <ProjectsExplorerDevMock />
    </>
  );
}
