"use client";

import "./project-explorer.css";

import {
  ProjectExplorerContext,
  ProjectExplorerRoot,
  useProjectExplorer as useProjectExplorerBound,
} from "./project-explorer.context";
import {
  ProjectExplorerHeaderBrand,
  ProjectExplorerHeaderToolbar,
  ProjectExplorerNewProjectButton,
  ProjectExplorerSearchField,
} from "./project-explorer.header";
import {
  ProjectExplorerHeader,
  ProjectExplorerShell,
} from "./project-explorer.layout";
import { ProjectExplorerList } from "./project-explorer.list";
import { ProjectExplorerListItem } from "./project-explorer.list-item";
import { ProjectExplorerVariant1 } from "./project-explorer.variant1";

// biome-ignore lint/performance/noBarrelFile: compound hook re-export for `import { useProjectExplorer }`
export { useProjectExplorer } from "./project-explorer.context";
export type {
  ProjectExplorerActions,
  ProjectExplorerEmptyState,
  ProjectExplorerProject,
  ProjectExplorerStates,
  ProjectExplorerValue,
} from "./project-explorer.types";

export const ProjectExplorer = Object.assign(ProjectExplorerShell, {
  Context: ProjectExplorerContext,
  Header: ProjectExplorerHeader,
  HeaderBrand: ProjectExplorerHeaderBrand,
  HeaderToolbar: ProjectExplorerHeaderToolbar,
  List: ProjectExplorerList,
  ListItem: ProjectExplorerListItem,
  NewProjectButton: ProjectExplorerNewProjectButton,
  Root: ProjectExplorerRoot,
  SearchField: ProjectExplorerSearchField,
  Shell: ProjectExplorerShell,
  Variant1: ProjectExplorerVariant1,
  useProjectExplorer: useProjectExplorerBound,
});

const dn = (c: object, name: string) => {
  (c as { displayName?: string }).displayName = name;
};
dn(ProjectExplorerRoot, "ProjectExplorer.Root");
dn(ProjectExplorerVariant1, "ProjectExplorer.Variant1");
dn(ProjectExplorerShell, "ProjectExplorer.Shell");
dn(ProjectExplorerHeader, "ProjectExplorer.Header");
dn(ProjectExplorerHeaderBrand, "ProjectExplorer.HeaderBrand");
dn(ProjectExplorerHeaderToolbar, "ProjectExplorer.HeaderToolbar");
dn(ProjectExplorerSearchField, "ProjectExplorer.SearchField");
dn(ProjectExplorerNewProjectButton, "ProjectExplorer.NewProjectButton");
dn(ProjectExplorerList, "ProjectExplorer.List");
dn(ProjectExplorerListItem, "ProjectExplorer.ListItem");
