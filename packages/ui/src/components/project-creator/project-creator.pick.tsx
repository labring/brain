"use client";

import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";
import { Database } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import {
  ProjectSourceDockerIcon,
  ProjectSourceGithubIcon,
} from "../../assets/project-source-icons";
import { useProjectCreator } from "./project-creator.context";
import type { ProjectCreatorSourceKind } from "./project-creator.types";
import { PROJECT_CREATOR_SOURCE_LABEL } from "./project-creator.types";

const ORDER: ProjectCreatorSourceKind[] = [
  "github",
  "docker-image",
  "database",
];

const DESCRIPTION: Record<ProjectCreatorSourceKind, string> = {
  github: "Import repository from URL or GitHub authorization.",
  "docker-image": "Create and run a project directly using an existing image.",
  database: "Set up a database project or data service first.",
};

const ICON: Record<
  ProjectCreatorSourceKind,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  github: ProjectSourceGithubIcon,
  "docker-image": ProjectSourceDockerIcon,
  database: Database,
};

const ICON_CLASS: Record<ProjectCreatorSourceKind, string> = {
  github: "text-resource-pane-foreground",
  "docker-image": "text-blue-500",
  database: "text-resource-pane-muted",
};

export function ProjectCreatorProjectNameField() {
  const { actions, states } = useProjectCreator(
    "ProjectCreator.ProjectNameField"
  );

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Label
        className="text-resource-pane-foreground leading-5"
        htmlFor="project-creator-display-name"
      >
        Project Name
      </Label>
      <Input
        aria-describedby={
          states.projectDisplayNameError
            ? "project-creator-display-name-error"
            : undefined
        }
        aria-invalid={states.projectDisplayNameError ? true : undefined}
        autoComplete="off"
        className="border-resource-pane-input bg-transparent text-resource-pane-foreground placeholder:text-resource-pane-muted focus-visible:border-blue-500 focus-visible:ring-[1px] focus-visible:ring-blue-500/50 dark:bg-transparent"
        id="project-creator-display-name"
        onChange={(event) =>
          actions.setProjectDisplayName(event.currentTarget.value)
        }
        placeholder="Placeholder"
        value={states.projectDisplayName}
      />
      {states.projectDisplayNameError ? (
        <p
          className="text-destructive text-xs leading-4"
          id="project-creator-display-name-error"
        >
          {states.projectDisplayNameError}
        </p>
      ) : null}
    </div>
  );
}

export function ProjectCreatorOptionPicker({
  className,
}: {
  className?: string;
}) {
  const { actions } = useProjectCreator("ProjectCreator.OptionPicker");

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-4", className)}
      data-slot="project-creator-option-picker"
    >
      <ProjectCreatorProjectNameField />
      <div className="flex min-w-0 flex-col gap-3">
        <p className="font-medium text-resource-pane-foreground text-sm leading-5">
          Scenario
        </p>
        <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {ORDER.map((id) => {
            const Icon = ICON[id];
            return (
              <button
                className="flex min-h-[76px] min-w-0 flex-col items-start gap-2 rounded-md border border-transparent p-2.5 text-left outline-none transition-colors hover:bg-resource-pane-card focus-visible:border-blue-500 focus-visible:ring-[1px] focus-visible:ring-blue-500/50 active:bg-resource-pane-card"
                data-slot="project-creator-option"
                key={id}
                onClick={() => actions.pick(id)}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon
                    aria-hidden
                    className={cn("size-4 shrink-0", ICON_CLASS[id])}
                  />
                  <span className="truncate font-medium text-resource-pane-foreground text-sm leading-5">
                    {PROJECT_CREATOR_SOURCE_LABEL[id]}
                  </span>
                </span>
                <span className="line-clamp-2 text-resource-pane-muted text-xs leading-4">
                  {DESCRIPTION[id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
