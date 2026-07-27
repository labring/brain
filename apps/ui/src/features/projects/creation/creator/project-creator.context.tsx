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
const PROJECT_DESCRIPTION_MAX_LENGTH = 256;

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
  /** Wired into the GitHub step’s `GithubDeployer` (authorize + repos + deploy). */
  githubDeployer?: ProjectCreatorGithubDeployerSlot;
  /** Optional initial source step for direct assistant/tool entry paths. */
  initialStep?: ProjectCreatorSourceKind | null;
  /** Template form values supplied by a direct URL entry. */
  initialTemplateArgs?: Record<string, string>;
  /** Template requested by a direct URL entry. */
  initialTemplateName?: string;
  /** Reports active source changes to outer chrome such as pane headers. */
  onStepChange?: (step: ProjectCreatorSourceKind | null) => void;
  /** Direct Template entry derives the Project Display Name from the selected template. */
  templateDirect?: boolean;
  /** Options for the template step combobox. */
  templateOptions?: ProjectCreatorTemplateChoice[];
  /** Catalog error shown within the existing Template deployment form. */
  templateOptionsError?: string;
  /** Disables Template deployment while the catalog is loading. */
  templateOptionsLoading?: boolean;
}

export function ProjectCreatorRoot({
  actions: actionsProp,
  confirmApplying = false,
  children,
  databaseOptions,
  databaseDirect = false,
  dockerDirect = false,
  enabledSources = DEFAULT_PROJECT_CREATOR_SOURCES,
  githubDeployer: githubDeployerProp,
  initialStep = null,
  initialTemplateArgs,
  initialTemplateName,
  onStepChange,
  templateDirect = false,
  templateOptions = [],
  templateOptionsError,
  templateOptionsLoading = false,
}: ProjectCreatorRootProps) {
  const [step, setStep] = useState<ProjectCreatorSourceKind | null>(
    initialStep
  );
  const [projectDescription, setProjectDescriptionState] = useState("");
  const [projectDescriptionError, setProjectDescriptionError] = useState<
    string | null
  >(null);
  const reset = useCallback(() => setStep(initialStep), [initialStep]);

  useEffect(() => {
    onStepChange?.(step);
  }, [onStepChange, step]);

  const validateProjectDescription = useCallback(
    (value: string): string | null => {
      if (value.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
        return "Project description must be 256 characters or fewer.";
      }
      return null;
    },
    []
  );

  const setProjectDescription = useCallback(
    (value: string) => {
      setProjectDescriptionState(value);
      setProjectDescriptionError(validateProjectDescription(value));
    },
    [validateProjectDescription]
  );

  const validateAndSetProjectDescriptionError = useCallback(
    (value?: string): string | null => {
      const error = validateProjectDescription(value ?? projectDescription);
      setProjectDescriptionError(error);
      return error;
    },
    [projectDescription, validateProjectDescription]
  );

  const pick = useCallback(
    (kind: ProjectCreatorSourceKind) => {
      if (validateAndSetProjectDescriptionError(projectDescription) != null) {
        return;
      }
      setStep(kind);
    },
    [projectDescription, validateAndSetProjectDescriptionError]
  );

  const [descriptionErrorInputs, setDescriptionErrorInputs] = useState({
    validate: validateProjectDescription,
    value: projectDescription,
  });
  if (
    descriptionErrorInputs.value !== projectDescription ||
    descriptionErrorInputs.validate !== validateProjectDescription
  ) {
    setDescriptionErrorInputs({
      validate: validateProjectDescription,
      value: projectDescription,
    });
    if (projectDescriptionError != null) {
      setProjectDescriptionError(
        validateProjectDescription(projectDescription)
      );
    }
  }

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
        projectDescription,
        projectDescriptionError,
        step,
      },
      actions: {
        pick,
        reset,
        setProjectDescription,
        validateProjectDescription: validateAndSetProjectDescriptionError,
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
        initialTemplateArgs,
        initialTemplateName,
        templateDirect,
        templateOptions,
        templateOptionsError,
        templateOptionsLoading,
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
      initialTemplateArgs,
      initialTemplateName,
      projectDescription,
      projectDescriptionError,
      setProjectDescription,
      templateDirect,
      templateOptions,
      templateOptionsError,
      templateOptionsLoading,
      validateAndSetProjectDescriptionError,
    ]
  );

  return (
    <ProjectCreatorContext.Provider value={value}>
      {children}
    </ProjectCreatorContext.Provider>
  );
}

export {
  DEFAULT_DATABASE_OPTIONS,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  ProjectCreatorContext,
};
