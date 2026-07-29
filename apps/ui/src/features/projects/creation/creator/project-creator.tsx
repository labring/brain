"use client";

import {
  ProjectCreatorContext,
  ProjectCreatorRoot,
  useProjectCreator as useProjectCreatorBound,
} from "./project-creator.context";
import { ProjectCreatorShell } from "./project-creator.layout";
import {
  ProjectCreatorOptionPicker,
  ProjectCreatorProjectDescriptionField,
} from "./project-creator.pick";
import { ProjectCreatorStage } from "./project-creator.stage";
import { ProjectCreatorTrail } from "./project-creator.trail";
import { ProjectCreatorVariant1 } from "./project-creator.variant1";

// biome-ignore lint/performance/noBarrelFile: compound hook re-export for `import { useProjectCreator }`
export { useProjectCreator } from "./project-creator.context";
export type {
  ProjectCreatorActions,
  ProjectCreatorDatabaseChoice,
  ProjectCreatorGithubDeployerSlot,
  ProjectCreatorSourceKind,
  ProjectCreatorStates,
  ProjectCreatorTemplateChoice,
  ProjectCreatorValue,
} from "./project-creator.types";
export { PROJECT_CREATOR_SOURCE_LABEL } from "./project-creator.types";

export const ProjectCreator = Object.assign(ProjectCreatorShell, {
  Context: ProjectCreatorContext,
  OptionPicker: ProjectCreatorOptionPicker,
  ProjectDescriptionField: ProjectCreatorProjectDescriptionField,
  Root: ProjectCreatorRoot,
  Shell: ProjectCreatorShell,
  Stage: ProjectCreatorStage,
  Trail: ProjectCreatorTrail,
  Variant1: ProjectCreatorVariant1,
  useProjectCreator: useProjectCreatorBound,
});

const dn = (c: object, name: string) => {
  (c as { displayName?: string }).displayName = name;
};
dn(ProjectCreatorRoot, "ProjectCreator.Root");
dn(ProjectCreatorShell, "ProjectCreator.Shell");
dn(ProjectCreatorTrail, "ProjectCreator.Trail");
dn(ProjectCreatorOptionPicker, "ProjectCreator.OptionPicker");
dn(
  ProjectCreatorProjectDescriptionField,
  "ProjectCreator.ProjectDescriptionField"
);
dn(ProjectCreatorStage, "ProjectCreator.Stage");
dn(ProjectCreatorVariant1, "ProjectCreator.Variant1");
