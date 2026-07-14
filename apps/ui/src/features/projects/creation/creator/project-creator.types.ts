import type {
  DatabaseDeploymentChoice,
  DatabaseDeploymentSettings,
} from "@/features/deploy/database-deployer";
import type { DockerDeploymentSettings } from "@/features/deploy/docker-deployer";
import type {
  GithubDeployerActions,
  GithubDeployerRepo,
  GithubDeployerStates,
} from "@/features/deploy/github-deployer/github-deployer.types";
import type {
  TemplateDeploymentChoice,
  TemplateDeploymentSettings,
} from "@/features/deploy/template-deployer";

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
    projectDisplayName: string,
    projectDescription: string
  ) => void | Promise<void>;
  onDockerConfirm?: (
    settings: DockerDeploymentSettings,
    projectDisplayName: string,
    projectDescription: string
  ) => void | Promise<void>;
  onGithubConfirm?: (
    repo: GithubDeployerRepo,
    projectDisplayName: string,
    projectDescription: string
  ) => void | Promise<void>;
  onTemplateConfirm?: (
    settings: TemplateDeploymentSettings,
    choice: ProjectCreatorTemplateChoice,
    projectDisplayName: string,
    projectDescription: string
  ) => void | Promise<void>;
}

export interface ProjectCreatorStates {
  /** When true after validation, disables Docker/DB Confirm and shows applying UI. */
  confirmApplying: boolean;
  /** Optional user-facing Project Description entered before choosing a creation source. */
  projectDescription: string;
  /** Field-level validation message for the Project Description entry. */
  projectDescriptionError: string | null;
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
    setProjectDescription: (value: string) => void;
    setProjectDisplayName: (value: string) => void;
    validateProjectDescription: (value?: string) => string | null;
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
