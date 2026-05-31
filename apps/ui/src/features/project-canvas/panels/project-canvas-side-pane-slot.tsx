"use client";

import { SidePanePresence } from "@workspace/ui/components/side-pane";
import type { ReactNode } from "react";

export type ProjectCanvasSidePaneEntry =
  | { kind: "databaseDeployment" }
  | { kind: "dockerDeployment" }
  | { kind: "githubDeployment" }
  | { kind: "resource" }
  | null;

export function ProjectCanvasSidePaneSlot({
  databaseDeploymentPane,
  dockerDeploymentPane,
  entry,
  githubDeploymentPane,
  resourcePane,
}: {
  databaseDeploymentPane?: ReactNode;
  dockerDeploymentPane?: ReactNode;
  entry: ProjectCanvasSidePaneEntry;
  githubDeploymentPane: ReactNode;
  resourcePane: ReactNode;
}) {
  let pane: ReactNode = null;

  if (entry?.kind === "databaseDeployment") {
    pane = databaseDeploymentPane;
  } else if (entry?.kind === "dockerDeployment") {
    pane = dockerDeploymentPane;
  } else if (entry?.kind === "githubDeployment") {
    pane = githubDeploymentPane;
  } else if (entry?.kind === "resource") {
    pane = resourcePane;
  }

  return <SidePanePresence>{pane}</SidePanePresence>;
}
