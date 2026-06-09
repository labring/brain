"use client";

import { SidePanePresence } from "@workspace/ui/components/side-pane";
import type { ReactNode } from "react";

export type ProjectCanvasSidePaneEntry =
  | { kind: "databaseDeployment" }
  | { kind: "dockerDeployment" }
  | { kind: "githubDeployment" }
  | { kind: "projectCreation" }
  | { kind: "resource" }
  | { kind: "skillsWorkflow" }
  | { kind: "templateDeployment" }
  | null;

export function ProjectCanvasSidePaneSlot({
  databaseDeploymentPane,
  dockerDeploymentPane,
  entry,
  githubDeploymentPane,
  projectCreationPane,
  resourcePane,
  skillsWorkflowPane,
  templateDeploymentPane,
}: {
  databaseDeploymentPane?: ReactNode;
  dockerDeploymentPane?: ReactNode;
  entry: ProjectCanvasSidePaneEntry;
  githubDeploymentPane: ReactNode;
  projectCreationPane?: ReactNode;
  resourcePane: ReactNode;
  skillsWorkflowPane?: ReactNode;
  templateDeploymentPane?: ReactNode;
}) {
  let pane: ReactNode = null;

  if (entry?.kind === "databaseDeployment") {
    pane = databaseDeploymentPane;
  } else if (entry?.kind === "dockerDeployment") {
    pane = dockerDeploymentPane;
  } else if (entry?.kind === "githubDeployment") {
    pane = githubDeploymentPane;
  } else if (entry?.kind === "projectCreation") {
    pane = projectCreationPane;
  } else if (entry?.kind === "skillsWorkflow") {
    pane = skillsWorkflowPane;
  } else if (entry?.kind === "templateDeployment") {
    pane = templateDeploymentPane;
  } else if (entry?.kind === "resource") {
    pane = resourcePane;
  }

  return <SidePanePresence>{pane}</SidePanePresence>;
}
