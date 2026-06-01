"use client";

import type { DatabaseDeploymentSettings } from "@workspace/ui/components/database-deployer";
import type { DockerDeploymentSettings } from "@workspace/ui/components/docker-deployer";
import type { GithubDeployerRepo } from "@workspace/ui/components/github-deployer/github-deployer.types";
import type { ProjectCreatorRootProps } from "@workspace/ui/components/project-creator/project-creator.context";
import type {
  ProjectCreatorActions,
  ProjectCreatorDatabaseChoice,
} from "@workspace/ui/components/project-creator/project-creator.types";
import type { ProjectExplorerProject } from "@workspace/ui/components/project-explorer/project-explorer";
import { useCallback, useMemo, useReducer, useState } from "react";
import { toast } from "sonner";

import {
  initialProjectCreationPaneState,
  type ProjectCreationPaneEntryMode,
  projectCreationPaneStateReducer,
} from "@/components/project-creation-pane-state";
import { createDeploymentTargetClientAdapters } from "@/features/deployment-target/client-adapters";
import {
  newProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "@/features/deployment-target/pipeline";
import { useApCompositions } from "@/hooks/compositions/use-ap-composition";
import { useDbCompositions } from "@/hooks/compositions/use-db-compositions";
import { useProjectCompositions } from "@/hooks/compositions/use-project-composition";
import { useGithubAuth } from "@/hooks/use-github-auth";
import { useGithubRepos } from "@/hooks/use-github-repos";
import { dbDeploymentChoicesFromCompositionRows } from "@/lib/db-composition-options";
import { dispatchDeployTaskCreatedEvent } from "@/lib/deploy-task/browser-events";
import { deriveDockerProjectDisplayName } from "@/lib/docker-project-display-name";
import { deriveGithubProjectDisplayName } from "@/lib/github-project-display-name";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";

const EMPTY_PROJECTS: readonly ProjectExplorerProject[] = [];

type CreatorRootPropsForCreationPane = Pick<
  ProjectCreatorRootProps,
  | "actions"
  | "confirmApplying"
  | "databaseOptions"
  | "existingProjectDisplayNames"
  | "githubDeployer"
>;

export interface UseProjectCreatorOptions {
  /** Existing Project rows in the namespace, used for display-name uniqueness checks. */
  existingProjects?: readonly ProjectExplorerProject[];
  /** Loads composition options from the API when set (same kubeconfig as explorer). */
  kubeconfig?: string;
  /** Target namespace for rendered claim `metadata.namespace`. */
  namespace?: string;
  /**
   * Called after a Project + child claim apply succeeds.
   * `projectUid` is `metadata.uid` when the API returns the Project in time; otherwise `undefined`.
   */
  onProjectCreated?: (projectUid: string | undefined) => void | Promise<void>;
}

export function useProjectCreator(options?: UseProjectCreatorOptions): {
  creatorRootProps: CreatorRootPropsForCreationPane;
  creatorResetKey: number;
  creationPaneOpen: boolean;
  creationPaneEntryMode: ProjectCreationPaneEntryMode;
  /** True while GitHub auth or repository list is loading for the deployer. */
  githubDeployerLoading: boolean;
  lastConfirmedKind: string | null;
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

  const { items: dbCompositionRows } = useDbCompositions({
    kubeconfig,
    toItems: true,
  });
  const { items: projectCompositionRows } = useProjectCompositions({
    kubeconfig,
    toItems: true,
  });
  const { items: apCompositionRows } = useApCompositions({
    kubeconfig,
    toItems: true,
  });

  const {
    initiateGithubAuth,
    isAuthorized: githubAuthorized,
    isLoading: githubAuthLoading,
  } = useGithubAuth();

  const {
    error: githubReposError,
    isLoading: githubReposLoading,
    mutate: mutateGithubRepos,
    repos: githubRepos,
  } = useGithubRepos({ isAuthorized: githubAuthorized, namespace });

  const openCreationPane = useCallback(
    (entryMode: ProjectCreationPaneEntryMode = "general") => {
      setConfirmApplying(false);
      dispatchCreationPaneState({ entryMode, type: "open" });
    },
    []
  );

  const onCreationPaneOpenChange = useCallback((open: boolean) => {
    if (open) {
      dispatchCreationPaneState({ entryMode: "general", type: "open" });
      return;
    }
    dispatchCreationPaneState({ type: "close" });
    setConfirmApplying(false);
  }, []);

  const databaseOptions = useMemo((): ProjectCreatorDatabaseChoice[] => {
    if (!hasKubeconfig) {
      return [];
    }
    return dbDeploymentChoicesFromCompositionRows(dbCompositionRows);
  }, [dbCompositionRows, hasKubeconfig]);

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
        apCompositionRows,
        credentialsReady: hasKubeconfig && namespace !== "",
        databaseOptions,
        existingProjects,
        namespace,
        projectCompositionRows,
        request,
        routingDomain: routingDomainFromKubeconfig(kubeconfig),
      }),
    [
      apCompositionRows,
      databaseOptions,
      deploymentAdapters,
      existingProjects,
      hasKubeconfig,
      kubeconfig,
      namespace,
      projectCompositionRows,
    ]
  );

  const actions = useMemo<ProjectCreatorActions>(
    () => ({
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
          await onProjectCreated?.(outcome.projectUid);
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
          await onProjectCreated?.(outcome.projectUid);
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
        await onProjectCreated?.(outcome.projectUid);
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
      githubDeployer,
    }),
    [
      actions,
      confirmApplying,
      databaseOptions,
      existingProjects,
      githubDeployer,
    ]
  );

  return {
    creationPaneEntryMode: creationPaneState.entryMode,
    creationPaneOpen: creationPaneState.open,
    creatorRootProps,
    creatorResetKey: creationPaneState.resetKey,
    githubDeployerLoading,
    lastConfirmedKind,
    onCreationPaneOpenChange,
    openCreationPane,
  };
}
