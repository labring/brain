import type {
  DatabaseDeploymentChoice,
  DatabaseDeploymentSettings,
} from "../database-deployer";
import type { DockerDeploymentSettings } from "../docker-deployer";
import type {
  GithubDeployerActions,
  GithubDeployerStates,
} from "../github-deployer/github-deployer.types";
import type {
  TemplateDeploymentChoice,
  TemplateDeploymentSettings,
} from "../template-deployer";

/** First step for project creation (breadcrumb + body). */
export type ProjectCreatorSourceKind =
  | "github"
  | "docker-image"
  | "database"
  | "template";

export type ProjectCreatorDatabaseChoice = DatabaseDeploymentChoice;
export type ProjectCreatorTemplateChoice = TemplateDeploymentChoice;

export const PROJECT_CREATOR_SOURCE_LABEL: Record<
  ProjectCreatorSourceKind,
  string
> = {
  github: "GitHub",
  "docker-image": "Docker Image",
  database: "Database",
  template: "Template",
};

export const DEFAULT_PROJECT_CREATOR_SOURCES: readonly ProjectCreatorSourceKind[] =
  ["github", "docker-image", "database"];

export interface ProjectCreatorActions {
  deriveDatabaseProjectDisplayName?: (
    choice: ProjectCreatorDatabaseChoice
  ) => string;
  deriveDockerProjectDisplayName?: (imageRef: string) => string;
  onDatabaseConfirm?: (
    settings: DatabaseDeploymentSettings,
    projectDisplayName: string
  ) => void | Promise<void>;
  onDockerConfirm?: (
    settings: DockerDeploymentSettings,
    projectDisplayName: string
  ) => void | Promise<void>;
  onGithubConfirm?: (
    url: string,
    projectDisplayName: string
  ) => void | Promise<void>;
  onTemplateConfirm?: (
    settings: TemplateDeploymentSettings,
    choice: ProjectCreatorTemplateChoice,
    projectDisplayName: string
  ) => void | Promise<void>;
}

export interface ProjectCreatorStates {
  /** When true after validation, disables Docker/DB Confirm and shows applying UI. */
  confirmApplying: boolean;
  /** User-facing Project Display Name entered before choosing a creation source. */
  projectDisplayName: string;
  /** Field-level validation message for the Project Display Name entry. */
  projectDisplayNameError: string | null;
  /** `null` shows the three-option column. */
  step: ProjectCreatorSourceKind | null;
}

export interface ProjectCreatorGithubDeployerSlot {
  actions?: GithubDeployerActions;
  states: GithubDeployerStates;
}

export interface ProjectCreatorValue {
  actions: {
    pick: (kind: ProjectCreatorSourceKind) => void;
    reset: () => void;
    setProjectDisplayName: (value: string) => void;
    validateProjectDisplayName: (value?: string) => string | null;
  } & ProjectCreatorActions;
  meta: {
    databaseOptions: ProjectCreatorDatabaseChoice[];
    enabledSources: readonly ProjectCreatorSourceKind[];
    templateOptions: ProjectCreatorTemplateChoice[];
    /** Direct Database entry derives the Project Display Name from the selected engine. */
    databaseDirect: boolean;
    dockerDirect: boolean;
    templateDirect: boolean;
    /** Enables `GithubDeployer` in the GitHub step (`ProjectCreatorStage`). Omit for an empty/disabled-looking deploy shell. */
    githubDeployer?: ProjectCreatorGithubDeployerSlot;
  };
  states: ProjectCreatorStates;
}
