"use client";

import { useCallback, useMemo, useReducer, useState } from "react";
import { toast } from "sonner";
import type { DatabaseDeploymentSettings } from "@/features/deployment/database-deployer";
import type { DockerDeploymentSettings } from "@/features/deployment/docker-deployer";
import type { GithubDeployerRepo } from "@/features/deployment/github-deployer/github-deployer.types";
import type { TemplateDeploymentSettings } from "@/features/deployment/template-deployer";
import { createDeploymentTargetClientAdapters } from "@/features/deployment-target/client-adapters";
import {
  newProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "@/features/deployment-target/pipeline";
import type { ProjectCreatorRootProps } from "@/features/project-creation/creator/project-creator.context";
import type {
  ProjectCreatorActions,
  ProjectCreatorDatabaseChoice,
  ProjectCreatorSourceKind,
} from "@/features/project-creation/creator/project-creator.types";
import {
  initialProjectCreationPaneState,
  type ProjectCreationPaneEntryMode,
  projectCreationPaneStateReducer,
} from "@/features/project-creation/project-creation-pane-state";
import type { ProjectExplorerProject } from "@/features/projects/explorer/project-explorer";
import { useGithubAuth } from "@/hooks/use-github-auth";
import { useGithubRepos } from "@/hooks/use-github-repos";
import { useTemplateCatalog } from "@/hooks/use-template-catalog";
import { deriveDatabaseProjectDisplayName } from "@/lib/database-project-display-name";
import { dispatchDeployTaskCreatedEvent } from "@/lib/deploy-task/browser-events";
import { DIRECT_DB_DEPLOYMENT_OPTIONS } from "@/lib/direct-db-deployment-options";
import { deriveDockerProjectDisplayName } from "@/lib/docker-project-display-name";
import { deriveGithubProjectDisplayName } from "@/lib/github-project-display-name";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";

const EMPTY_PROJECTS: readonly ProjectExplorerProject[] = [];
const CREATION_PANE_SOURCES: readonly ProjectCreatorSourceKind[] = [
  "github",
  "docker-image",
  "database",
  "template",
];

function sourceKindFromEntryMode(
  entryMode: ProjectCreationPaneEntryMode
): ProjectCreatorSourceKind | null {
  switch (entryMode) {
    case "githubDirect":
      return "github";
    case "dockerDirect":
      return "docker-image";
    case "databaseDirect":
      return "database";
    case "templateDirect":
      return "template";
    default:
      return null;
  }
}

export function projectCreatorIntegrationState(input: {
  activeSource: ProjectCreatorSourceKind | null;
  open: boolean;
}): {
  githubEnabled: boolean;
  templateEnabled: boolean;
} {
  return {
    githubEnabled: input.open && input.activeSource === "github",
    templateEnabled: input.open && input.activeSource === "template",
  };
}

type CreatorRootPropsForCreationPane = Pick<
  ProjectCreatorRootProps,
  | "actions"
  | "confirmApplying"
  | "databaseOptions"
  | "enabledSources"
  | "existingProjectDisplayNames"
  | "githubDeployer"
  | "templateOptions"
>;

export interface UseProjectCreatorOptions {
  /** Existing Project rows in the namespace, used for display-name uniqueness checks. */
  existingProjects?: readonly ProjectExplorerProject[];
  /** Kubeconfig used by product APIs when set (same kubeconfig as explorer). */
  kubeconfig?: string;
  /** Target namespace for rendered product manifests. */
  namespace?: string;
  /**
   * Called after a Project + child product resource create succeeds.
   * `projectId` currently carries the Brain Project ID for compatibility with older prop names.
   */
  onProjectCreated?: (projectId: string | undefined) => void | Promise<void>;
}

export function useProjectCreator(options?: UseProjectCreatorOptions): {
  creatorRootProps: CreatorRootPropsForCreationPane;
  creatorResetKey: number;
  creationPaneOpen: boolean;
  creationPaneEntryMode: ProjectCreationPaneEntryMode;
  /** True while GitHub auth or repository list is loading for the deployer. */
  githubDeployerLoading: boolean;
  lastConfirmedKind: string | null;
  onCreationPaneSourceChange: (source: ProjectCreatorSourceKind | null) => void;
  onCreationPaneOpenChange: (open: boolean) => void;
  openCreationPane: (entryMode?: ProjectCreationPaneEntryMode) => void;
} {
  const kubeconfig = options?.kubeconfig?.trim() ?? "";
  const namespace = options?.namespace?.trim() ?? "";
  const onProjectCreated = options?.onProjectCreated;
  const existingProjects = options?.existingProjects ?? EMPTY_PROJECTS;
  const hasKubeconfig = kubeconfig !== "";

  const [creationPaneState, dispatchCreationPaneState] = useReducer(
    projectCreationPaneStateReducer,
    initialProjectCreationPaneState
  );
  const [confirmApplying, setConfirmApplying] = useState(false);
  const [lastConfirmedKind, setLastConfirmedKind] = useState<string | null>(
    null
  );
  const [activeSource, setActiveSource] =
    useState<ProjectCreatorSourceKind | null>(null);
  const integrationState = projectCreatorIntegrationState({
    activeSource,
    open: creationPaneState.open,
  });

  const {
    initiateGithubAuth,
    isAuthorized: githubAuthorized,
    isLoading: githubAuthLoading,
  } = useGithubAuth({ enabled: integrationState.githubEnabled });

  const {
    error: githubReposError,
    isLoading: githubReposLoading,
    mutate: mutateGithubRepos,
    repos: githubRepos,
  } = useGithubRepos({
    isAuthorized: integrationState.githubEnabled && githubAuthorized,
    namespace,
  });
  const templateCatalog = useTemplateCatalog({
    enabled: integrationState.templateEnabled,
  });

  const openCreationPane = useCallback(
    (entryMode: ProjectCreationPaneEntryMode = "general") => {
      setConfirmApplying(false);
      setActiveSource(sourceKindFromEntryMode(entryMode));
      dispatchCreationPaneState({ entryMode, type: "open" });
    },
    []
  );

  const onCreationPaneOpenChange = useCallback((open: boolean) => {
    if (open) {
      setActiveSource(null);
      dispatchCreationPaneState({ entryMode: "general", type: "open" });
      return;
    }
    setActiveSource(null);
    dispatchCreationPaneState({ type: "close" });
    setConfirmApplying(false);
  }, []);

  const onCreationPaneSourceChange = useCallback(
    (source: ProjectCreatorSourceKind | null) => {
      setActiveSource(source);
    },
    []
  );

  const databaseOptions = useMemo((): ProjectCreatorDatabaseChoice[] => {
    return [...DIRECT_DB_DEPLOYMENT_OPTIONS];
  }, []);

  const githubDeployerLoading =
    confirmApplying ||
    githubAuthLoading ||
    (githubAuthorized && githubReposLoading);

  const applyWithBusyState = useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      setConfirmApplying(true);
      try {
        await fn();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Apply failed");
      } finally {
        setConfirmApplying(false);
      }
    },
    []
  );

  const deploymentAdapters = useMemo(
    () => createDeploymentTargetClientAdapters({ kubeconfig, namespace }),
    [kubeconfig, namespace]
  );

  const runDeployment = useCallback(
    (request: Parameters<typeof runDeploymentTargetPipeline>[0]["request"]) =>
      runDeploymentTargetPipeline({
        adapters: deploymentAdapters,
        credentialsReady: hasKubeconfig && namespace !== "",
        databaseOptions,
        existingProjects,
        namespace,
        request,
        routingDomain: routingDomainFromKubeconfig(kubeconfig),
      }),
    [
      databaseOptions,
      deploymentAdapters,
      existingProjects,
      hasKubeconfig,
      kubeconfig,
      namespace,
    ]
  );

  const actions = useMemo<ProjectCreatorActions>(
    () => ({
      deriveDatabaseProjectDisplayName: (choice) =>
        deriveDatabaseProjectDisplayName({
          choice,
          existingProjectDisplayNames: existingProjects.map(
            (project) => project.name
          ),
        }),
      deriveDockerProjectDisplayName: (imageRef: string) =>
        deriveDockerProjectDisplayName({
          existingProjectDisplayNames: existingProjects.map(
            (project) => project.name
          ),
          imageRef,
        }),
      onDockerConfirm: async (
        settings: DockerDeploymentSettings,
        projectDisplayName
      ) => {
        const displayName = projectDisplayName.trim();
        await applyWithBusyState(async () => {
          const outcome = await runDeployment({
            kind: "docker",
            settings,
            target: newProjectDeploymentTarget(displayName),
          });
          if (outcome.kind !== "docker") {
            return;
          }
          toast.success(
            `Applied project "${displayName}" and AP "${outcome.apName}".`
          );
          setLastConfirmedKind(
            `docker:${settings.image}:${outcome.projectName}`
          );
          dispatchCreationPaneState({ type: "close" });
          await onProjectCreated?.(outcome.projectId);
        });
      },
      onDatabaseConfirm: async (
        settings: DatabaseDeploymentSettings,
        projectDisplayName
      ) => {
        const displayName = projectDisplayName.trim();
        await applyWithBusyState(async () => {
          const outcome = await runDeployment({
            kind: "database",
            settings,
            target: newProjectDeploymentTarget(displayName),
          });
          if (outcome.kind !== "database") {
            return;
          }
          toast.success(
            `Applied project "${displayName}" and database "${outcome.dbName}".`
          );
          setLastConfirmedKind(
            `database:${settings.databaseId}:${outcome.projectName}`
          );
          dispatchCreationPaneState({ type: "close" });
          await onProjectCreated?.(outcome.projectId);
        });
      },
      onTemplateConfirm: async (
        settings: TemplateDeploymentSettings,
        choice,
        projectDisplayName
      ) => {
        const displayName = projectDisplayName.trim();
        await applyWithBusyState(async () => {
          const outcome = await runDeployment({
            args: settings.args,
            kind: "template",
            target: newProjectDeploymentTarget(displayName),
            templateName: settings.templateName,
          });
          if (outcome.kind !== "template") {
            return;
          }
          toast.success(
            `Applied project "${displayName}" and template "${outcome.instanceName}".`
          );
          setLastConfirmedKind(
            `template:${choice.name}:${outcome.projectName}`
          );
          dispatchCreationPaneState({ type: "close" });
          await onProjectCreated?.(outcome.projectId);
        });
      },
    }),
    [applyWithBusyState, existingProjects, onProjectCreated, runDeployment]
  );

  const handleGithubDeploy = useCallback(
    async (repo: GithubDeployerRepo) => {
      const displayName = deriveGithubProjectDisplayName({
        existingProjectDisplayNames: existingProjects.map(
          (project) => project.name
        ),
        repository: repo,
      });
      await applyWithBusyState(async () => {
        const outcome = await runDeployment({
          kind: "github",
          repository: repo,
          target: newProjectDeploymentTarget(displayName),
        });
        if (outcome.kind !== "github") {
          return;
        }
        toast.success(
          `Created project "${displayName}". ${outcome.taskMessage}`
        );
        if (outcome.taskId != null) {
          dispatchDeployTaskCreatedEvent({
            projectName: outcome.projectName,
            repoFullName: outcome.repoFullName,
            taskId: outcome.taskId,
          });
        }
        setLastConfirmedKind(
          `github:${outcome.repoFullName}:${outcome.projectName}`
        );
        dispatchCreationPaneState({ type: "close" });
        await onProjectCreated?.(outcome.projectId);
      });
    },
    [applyWithBusyState, existingProjects, onProjectCreated, runDeployment]
  );

  const githubDeployer = useMemo(
    () => ({
      actions: {
        onAuthorize: initiateGithubAuth,
        onDeploy: handleGithubDeploy,
      },
      states: {
        deployedRepo: null,
        isAuthorized: githubAuthorized,
        isLoading: githubDeployerLoading,
        repoError: githubReposError,
        repoRetry: () => {
          mutateGithubRepos().catch(() => undefined);
        },
        repos: githubRepos,
      },
    }),
    [
      githubDeployerLoading,
      githubReposError,
      githubRepos,
      githubAuthorized,
      handleGithubDeploy,
      initiateGithubAuth,
      mutateGithubRepos,
    ]
  );

  const creatorRootProps = useMemo(
    () => ({
      actions,
      confirmApplying,
      databaseOptions,
      existingProjectDisplayNames: existingProjects.map(
        (project) => project.name
      ),
      enabledSources: CREATION_PANE_SOURCES,
      githubDeployer,
      templateOptions: templateCatalog.templates,
    }),
    [
      actions,
      confirmApplying,
      databaseOptions,
      existingProjects,
      githubDeployer,
      templateCatalog.templates,
    ]
  );

  return {
    creationPaneEntryMode: creationPaneState.entryMode,
    creationPaneOpen: creationPaneState.open,
    creatorRootProps,
    creatorResetKey: creationPaneState.resetKey,
    githubDeployerLoading,
    lastConfirmedKind,
    onCreationPaneSourceChange,
    onCreationPaneOpenChange,
    openCreationPane,
  };
}
