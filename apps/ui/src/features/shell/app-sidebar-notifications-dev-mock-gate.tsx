"use client";

import dynamic from "next/dynamic";

// Same inlined gate as dev-tweaks.tsx: a real production build statically
// drops the dynamic import and tree-shakes the mock module away;
// `NEXT_PUBLIC_DEV_TWEAKS=1` keeps it for demo deployments.
const AppSidebarNotificationsDevMock =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEV_TWEAKS === "1"
    ? dynamic(() =>
        import("./app-sidebar-notifications-dev-mock").then(
          (mod) => mod.AppSidebarNotificationsDevMock
        )
      )
    : null;

/** Mounts the notifications mock's dev-tweaks registration with the sidebar. */
export function AppSidebarNotificationsDevMockGate() {
  if (!AppSidebarNotificationsDevMock) {
    return null;
  }
  return <AppSidebarNotificationsDevMock />;
}
