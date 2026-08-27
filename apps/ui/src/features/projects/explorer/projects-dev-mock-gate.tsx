"use client";

import dynamic from "next/dynamic";

// Same inlined gate as dev-tweaks.tsx: a real production build statically
// drops the dynamic import and tree-shakes the mock module away;
// `NEXT_PUBLIC_DEV_TWEAKS=1` keeps it for demo deployments.
const ProjectsExplorerDevMock =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEV_TWEAKS === "1"
    ? dynamic(() =>
        import("./projects-dev-mock").then((mod) => mod.ProjectsExplorerDevMock)
      )
    : null;

/** Mounts the Projects mock's dev-tweaks registration with the /project shell. */
export function ProjectsExplorerDevMockGate() {
  if (!ProjectsExplorerDevMock) {
    return null;
  }
  return <ProjectsExplorerDevMock />;
}
