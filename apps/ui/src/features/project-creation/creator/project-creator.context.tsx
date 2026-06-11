"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  ProjectCreatorActions,
  ProjectCreatorDatabaseChoice,
  ProjectCreatorGithubDeployerSlot,
  ProjectCreatorSourceKind,
  ProjectCreatorTemplateChoice,
  ProjectCreatorValue,
} from "./project-creator.types";
import { DEFAULT_PROJECT_CREATOR_SOURCES } from "./project-creator.types";

const ProjectCreatorContext = createContext<ProjectCreatorValue | null>(null);

export function useProjectCreator(
  component = "ProjectCreator"
): ProjectCreatorValue {
  const ctx = useContext(ProjectCreatorContext);
  if (!ctx) {
    throw new Error(
      `${component} compound parts must be used within ProjectCreator.Root`
    );
  }
  return ctx;
}

const DEFAULT_DATABASE_OPTIONS: ProjectCreatorDatabaseChoice[] = [
  { engine: "postgresql", id: "postgresql", label: "PostgreSQL" },
  { engine: "mysql", id: "mysql", label: "MySQL" },
  { engine: "mongodb", id: "mongodb", label: "MongoDB" },
  { engine: "redis", id: "redis", label: "Redis" },
];

export interface ProjectCreatorRootProps {
  actions?: ProjectCreatorActions;
  children: ReactNode;
  /** Disables Confirm on Docker/database steps during async apply. */
  confirmApplying?: boolean;
  /** Direct Database entry derives the Project Display Name from the selected engine. */
  databaseDirect?: boolean;
  /** Options for the database step combobox. */
  databaseOptions?: ProjectCreatorDatabaseChoice[];
  /** Direct Docker entry derives the Project Display Name from the image first. */
  dockerDirect?: boolean;
  /** Sources shown on the first Project Creator step. */
  enabledSources?: readonly ProjectCreatorSourceKind[];
  /** Existing Project Display Names in the current namespace. */
  existingProjectDisplayNames?: readonly string[];
  /** Wired into the GitHub step’s `GithubDeployer` (authorize + repos + deploy). */
  githubDeployer?: ProjectCreatorGithubDeployerSlot;
  /** Optional initial source step for direct assistant/tool entry paths. */
  initialStep?: ProjectCreatorSourceKind | null;
  /** Reports active source changes to outer chrome such as pane headers. */
  onStepChange?: (step: ProjectCreatorSourceKind | null) => void;
  /** Direct Template entry derives the Project Display Name from the selected template. */
  templateDirect?: boolean;
  /** Options for the template step combobox. */
  templateOptions?: ProjectCreatorTemplateChoice[];
}

function normalizeProjectCreatorDisplayName(name: string): string {
  return name.trim().toLowerCase();
}

export function ProjectCreatorRoot({
  actions: actionsProp,
  confirmApplying = false,
  children,
  databaseOptions,
  databaseDirect = false,
  dockerDirect = false,
  enabledSources = DEFAULT_PROJECT_CREATOR_SOURCES,
  existingProjectDisplayNames = [],
  githubDeployer: githubDeployerProp,
  initialStep = null,
  onStepChange,
  templateDirect = false,
  templateOptions = [],
}: ProjectCreatorRootProps) {
  const [step, setStep] = useState<ProjectCreatorSourceKind | null>(
    initialStep
  );
  const [projectDisplayName, setProjectDisplayNameState] = useState("");
  const [projectDisplayNameError, setProjectDisplayNameError] = useState<
    string | null
  >(null);
  const reset = useCallback(() => setStep(initialStep), [initialStep]);

  useEffect(() => {
    onStepChange?.(step);
  }, [onStepChange, step]);

  const existingDisplayNameSet = useMemo(
    () =>
      new Set(
        existingProjectDisplayNames
          .map(normalizeProjectCreatorDisplayName)
          .filter(Boolean)
      ),
    [existingProjectDisplayNames]
  );

  const validateProjectDisplayName = useCallback(
    (value: string): string | null => {
      const trimmed = value.trim();
      if (trimmed === "") {
        return "Project name is required.";
      }
      if (
        existingDisplayNameSet.has(normalizeProjectCreatorDisplayName(value))
      ) {
        return `A project named "${trimmed}" already exists.`;
      }
      return null;
    },
    [existingDisplayNameSet]
  );

  const setProjectDisplayName = useCallback(
    (value: string) => {
      setProjectDisplayNameState(value);
      setProjectDisplayNameError((current) =>
        current == null ? null : validateProjectDisplayName(value)
      );
    },
    [validateProjectDisplayName]
  );

  const validateAndSetProjectDisplayNameError = useCallback(
    (value?: string): string | null => {
      const error = validateProjectDisplayName(value ?? projectDisplayName);
      setProjectDisplayNameError(error);
      return error;
    },
    [projectDisplayName, validateProjectDisplayName]
  );

  const pick = useCallback(
    (kind: ProjectCreatorSourceKind) => {
      const error = validateAndSetProjectDisplayNameError(projectDisplayName);
      if (error != null) {
        return;
      }
      setStep(kind);
    },
    [projectDisplayName, validateAndSetProjectDisplayNameError]
  );

  useEffect(() => {
    if (projectDisplayNameError != null) {
      setProjectDisplayNameError(
        validateProjectDisplayName(projectDisplayName)
      );
    }
  }, [projectDisplayName, projectDisplayNameError, validateProjectDisplayName]);

  const dbOptions = useMemo(
    () =>
      databaseOptions === undefined
        ? DEFAULT_DATABASE_OPTIONS
        : databaseOptions,
    [databaseOptions]
  );

  const value = useMemo<ProjectCreatorValue>(
    () => ({
      states: {
        confirmApplying,
        projectDisplayName,
        projectDisplayNameError,
        step,
      },
      actions: {
        pick,
        reset,
        setProjectDisplayName,
        validateProjectDisplayName: validateAndSetProjectDisplayNameError,
        deriveDatabaseProjectDisplayName:
          actionsProp?.deriveDatabaseProjectDisplayName,
        deriveDockerProjectDisplayName:
          actionsProp?.deriveDockerProjectDisplayName,
        onGithubConfirm: actionsProp?.onGithubConfirm,
        onDockerConfirm: actionsProp?.onDockerConfirm,
        onDatabaseConfirm: actionsProp?.onDatabaseConfirm,
        onTemplateConfirm: actionsProp?.onTemplateConfirm,
      },
      meta: {
        databaseOptions: dbOptions,
        databaseDirect,
        dockerDirect,
        enabledSources,
        githubDeployer: githubDeployerProp,
        templateDirect,
        templateOptions,
      },
    }),
    [
      confirmApplying,
      step,
      reset,
      pick,
      actionsProp,
      databaseDirect,
      dbOptions,
      dockerDirect,
      enabledSources,
      githubDeployerProp,
      projectDisplayName,
      projectDisplayNameError,
      setProjectDisplayName,
      templateDirect,
      templateOptions,
      validateAndSetProjectDisplayNameError,
    ]
  );

  return (
    <ProjectCreatorContext.Provider value={value}>
      {children}
    </ProjectCreatorContext.Provider>
  );
}

export { DEFAULT_DATABASE_OPTIONS, ProjectCreatorContext };
