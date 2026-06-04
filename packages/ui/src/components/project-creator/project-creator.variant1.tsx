"use client";

import type { ComponentProps } from "react";

import { ProjectCreatorShell } from "./project-creator.layout";
import { ProjectCreatorStage } from "./project-creator.stage";

export function ProjectCreatorVariant1({
  className,
  ...props
}: ComponentProps<typeof ProjectCreatorShell>) {
  return (
    <ProjectCreatorShell className={className} {...props}>
      <ProjectCreatorStage />
    </ProjectCreatorShell>
  );
}
