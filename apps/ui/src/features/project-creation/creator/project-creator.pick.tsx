"use client";

import {
  ProjectSourceDockerIcon,
  ProjectSourceGithubIcon,
} from "@workspace/ui/assets/project-source-icons";
import { AppInputField } from "@workspace/ui/components/app-input-field";
import { AppTextarea } from "@workspace/ui/components/app-textarea";
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field";
import { cn } from "@workspace/ui/lib/utils";
import { Blocks, Database } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  useProjectCreator,
} from "./project-creator.context";
import {
  DEFAULT_PROJECT_CREATOR_SOURCES,
  PROJECT_CREATOR_SOURCE_LABEL,
  type ProjectCreatorSourceKind,
} from "./project-creator.types";

const ORDER: readonly ProjectCreatorSourceKind[] = [
  ...DEFAULT_PROJECT_CREATOR_SOURCES,
  "template",
];

const DESCRIPTION: Record<ProjectCreatorSourceKind, string> = {
  github: "Import repository from URL or GitHub authorization.",
  "docker-image": "Create and run a project directly using an existing image.",
  database: "Set up a database project or data service first.",
  template: "Deploy a preconfigured application template.",
};

const ICON: Record<
  ProjectCreatorSourceKind,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  github: ProjectSourceGithubIcon,
  "docker-image": ProjectSourceDockerIcon,
  database: Database,
  template: Blocks,
};

export function ProjectCreatorProjectNameField() {
  const { actions, states } = useProjectCreator(
    "ProjectCreator.ProjectNameField"
  );

  return (
    <AppInputField
      autoComplete="off"
      error={states.projectDisplayNameError}
      id="project-creator-display-name"
      inputClassName="border-input bg-transparent text-foreground placeholder:text-muted-foreground focus-visible:border-blue-500 focus-visible:ring-[1px] focus-visible:ring-blue-500/50 dark:bg-transparent"
      label="Project Name"
      onChange={(event) =>
        actions.setProjectDisplayName(event.currentTarget.value)
      }
      placeholder="Placeholder"
      value={states.projectDisplayName}
    />
  );
}

export function ProjectCreatorProjectDescriptionField() {
  const { actions, states } = useProjectCreator(
    "ProjectCreator.ProjectDescriptionField"
  );
  const descriptionLength = states.projectDescription.length;

  return (
    <Field className="gap-2" data-slot="project-creator-description-field">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel
          className="text-foreground leading-none"
          htmlFor="project-creator-description"
        >
          Description
        </FieldLabel>
        <span className="text-[11px] text-muted-foreground leading-4">
          {`${descriptionLength}/${PROJECT_DESCRIPTION_MAX_LENGTH}`}
        </span>
      </div>
      <AppTextarea
        aria-invalid={
          states.projectDescriptionError === null ? undefined : true
        }
        className="min-h-9 resize-none border-input bg-transparent text-foreground placeholder:text-muted-foreground focus-visible:border-blue-500 focus-visible:ring-[1px] focus-visible:ring-blue-500/50 dark:bg-transparent"
        id="project-creator-description"
        maxLength={PROJECT_DESCRIPTION_MAX_LENGTH + 1}
        onChange={(event) =>
          actions.setProjectDescription(event.currentTarget.value)
        }
        placeholder="Optional project context"
        rows={1}
        value={states.projectDescription}
      />
      {states.projectDescriptionError === null ? null : (
        <FieldError className="text-xs leading-4" role="alert">
          {states.projectDescriptionError}
        </FieldError>
      )}
    </Field>
  );
}

export function ProjectCreatorOptionPicker({
  className,
}: {
  className?: string;
}) {
  const { actions, meta } = useProjectCreator("ProjectCreator.OptionPicker");

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-4", className)}
      data-slot="project-creator-option-picker"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-col gap-2">
          {ORDER.filter((id) => meta.enabledSources.includes(id)).map((id) => {
            const Icon = ICON[id];
            return (
              <button
                className="flex min-h-[76px] min-w-0 flex-col items-start gap-1.5 rounded-md border border-transparent p-2.5 text-left outline-none transition-colors hover:bg-input/30 focus-visible:border-blue-500 focus-visible:ring-[1px] focus-visible:ring-blue-500/50 active:bg-input/30"
                data-slot="project-creator-option"
                key={id}
                onClick={() => actions.pick(id)}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon
                    aria-hidden
                    className="size-4 shrink-0 text-foreground"
                  />
                  <span className="truncate font-medium text-foreground text-sm leading-5">
                    {PROJECT_CREATOR_SOURCE_LABEL[id]}
                  </span>
                </span>
                <span className="line-clamp-2 text-muted-foreground text-xs leading-4">
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
