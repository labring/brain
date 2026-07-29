"use client";

import { useCallback, useMemo, useReducer, useState } from "react";
import { toast } from "sonner";
import type { DatabaseDeploymentSettings } from "@/features/deploy/database-deployer";
import { DIRECT_DB_DEPLOYMENT_OPTIONS } from "@/features/deploy/direct-db-deployment-options";
import type { DockerDeploymentSettings } from "@/features/deploy/docker-deployer";
import {
  findTemplateForGithubRepo,
  templateCanDeployWithDefaults,
} from "@/features/deploy/github/github-template-match";
import { useGithubAuth } from "@/features/deploy/github/use-github-auth";
import { useGithubRepos } from "@/features/deploy/github/use-github-repos";
import type { GithubDeployerRepo } from "@/features/deploy/github-deployer/github-deployer.types";
import {
  type DeploymentTargetPipelineOutcome,
  newProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "@/features/deploy/pipeline";
import type { TemplateDeploymentSettings } from "@/features/deploy/template-deployer";
import { useDeploymentTargetAdapters } from "@/features/deploy/use-deployment-target-adapters";
import { useTemplateCatalog } from "@/features/deploy/use-template-catalog";
import { requestAssistantDraftThread } from "@/features/panes/layout-store";
import type { ProjectCreatorRootProps } from "@/features/projects/creation/creator/project-creator.context";
import type {
  ProjectCreatorActions,
  ProjectCreatorDatabaseChoice,
  ProjectCreatorSourceKind,
} from "@/features/projects/creation/creator/project-creator.types";
import {
  initialProjectCreationPaneState,
  type ProjectCreationPaneEntryMode,
  projectCreationPaneStateReducer,
} from "@/features/projects/creation/project-creation-pane-state";
import { errorDescription, toastErrorDetail } from "@/lib/toast-utils";

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
    templateEnabled:
      input.open &&
      (input.activeSource === "template" || input.activeSource === "github"),
  };
}

type CreatorRootPropsForCreationPane = Pick<
  ProjectCreatorRootProps,
  | "actions"
  | "confirmApplying"
  | "databaseOptions"
  | "enabledSources"
  | "githubDeployer"
  | "initialTemplateArgs"
  | "initialTemplateName"
  | "templateOptions"
  | "templateOptionsError"
  | "templateOptionsLoading"
>;

export interface ProjectCreatedContext {
  deploymentTaskId?: string;
}

export interface UseProjectCreatorOptions {
  /** Kubeconfig used by product APIs when set (same kubeconfig as explorer). */
  kubeconfig?: string;
  /** Target namespace for rendered product manifests. */
  namespace?: string;
  /**
   * Called after a Project + child product resource create succeeds.
   * `projectId` currently carries the Brain Project ID for compatibility with older prop names.
   */
  onProjectCreated?: (
    projectId: string | undefined,
    context?: ProjectCreatedContext
  ) => void | Promise<void>;
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
  openCreationPane: (
    entryMode?: ProjectCreationPaneEntryMode,
    templateName?: string,
    templateArgs?: Record<string, string>
  ) => void;
} {
  const kubeconfig = options?.kubeconfig?.trim() ?? "";
  const namespace = options?.namespace?.trim() ?? "";
  const onProjectCreated = options?.onProjectCreated;
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
    disconnectGithubAuth,
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
  const catalogTemplates = templateCatalog.templates;

  const openCreationPane = useCallback(
    (
      entryMode: ProjectCreationPaneEntryMode = "general",
      templateName?: string,
      templateArgs?: Record<string, string>
    ) => {
      setConfirmApplying(false);
      setActiveSource(sourceKindFromEntryMode(entryMode));
      dispatchCreationPaneState({
        entryMode,
        templateArgs,
        templateName,
        type: "open",
      });
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
        toastErrorDetail(
          "Apply failed.",
          errorDescription(err, "Apply failed.")
        );
      } finally {
        setConfirmApplying(false);
      }
    },
    []
  );

  const deploymentAdapters = useDeploymentTargetAdapters({
    kubeconfig,
    namespace,
  });

  const runDeployment = useCallback(
    (request: Parameters<typeof runDeploymentTargetPipeline>[0]["request"]) =>
      runDeploymentTargetPipeline({
        adapters: deploymentAdapters,
        credentialsReady:
          hasKubeconfig &&
          namespace !== "" &&
          (request.kind !== "github" || githubAuthorized),
        namespace,
        request,
      }),
    [deploymentAdapters, githubAuthorized, hasKubeconfig, namespace]
  );
  const completeProjectCreation = useCallback(
    (
      outcome: Pick<DeploymentTargetPipelineOutcome, "projectId" | "taskId">
    ) => {
      const projectId = outcome.projectId.trim();
      const taskId = outcome.taskId?.trim();
      if (projectId !== "") {
        // Pane-created project = a task switch for the assistant: whatever the
        // user says next starts a fresh draft thread, not the old conversation.
        // Chat-created projects never pass through here, so their conversation
        // continues uninterrupted.
        requestAssistantDraftThread();
      }
      return onProjectCreated?.(
        projectId === "" ? undefined : projectId,
        taskId == null || taskId === ""
          ? undefined
          : { deploymentTaskId: taskId }
      );
    },
    [onProjectCreated]
  );

  const actions = useMemo<ProjectCreatorActions>(
    () => ({
      onDockerConfirm: async (
        settings: DockerDeploymentSettings,
        projectDescription
      ) => {
        const description = projectDescription.trim();
        await applyWithBusyState(async () => {
          const outcome = await runDeployment({
            kind: "docker",
            settings,
            target: newProjectDeploymentTarget(description),
          });
          if (outcome.kind !== "docker") {
            return;
          }
          toast.success(outcome.taskMessage);
          setLastConfirmedKind(
            `docker:${settings.image}:${outcome.projectName}`
          );
          dispatchCreationPaneState({ type: "close" });
          await completeProjectCreation(outcome);
        });
      },
      onDatabaseConfirm: async (
        settings: DatabaseDeploymentSettings,
        projectDescription
      ) => {
        const description = projectDescription.trim();
        await applyWithBusyState(async () => {
          const outcome = await runDeployment({
            kind: "database",
            settings,
            target: newProjectDeploymentTarget(description),
          });
          if (outcome.kind !== "database") {
            return;
          }
          toast.success(outcome.taskMessage);
          setLastConfirmedKind(
            `database:${settings.databaseId}:${outcome.projectName}`
          );
          dispatchCreationPaneState({ type: "close" });
          await completeProjectCreation(outcome);
        });
      },
      onTemplateConfirm: async (
        settings: TemplateDeploymentSettings,
        choice,
        projectDescription
      ) => {
        const description = projectDescription.trim();
        await applyWithBusyState(async () => {
          const outcome = await runDeployment({
            args: settings.args,
            kind: "template",
            sensitiveKeys: settings.sensitiveKeys,
            target: newProjectDeploymentTarget(description),
            templateName: settings.templateName,
          });
          if (outcome.kind !== "template") {
            return;
          }
          toast.success(outcome.taskMessage);
          setLastConfirmedKind(
            `template:${choice.name}:${outcome.projectName}`
          );
          dispatchCreationPaneState({ type: "close" });
          await completeProjectCreation(outcome);
        });
      },
      onGithubConfirm: async (repo: GithubDeployerRepo, projectDescription) => {
        const description = projectDescription.trim();
        await applyWithBusyState(async () => {
          const outcome = await runDeployment({
            kind: "github",
            repository: repo,
            target: newProjectDeploymentTarget(description),
          });
          if (outcome.kind !== "github") {
            return;
          }
          toast.success(outcome.taskMessage);
          setLastConfirmedKind(
            `github:${outcome.sourceLabel}:${outcome.projectName}`
          );
          dispatchCreationPaneState({ type: "close" });
          await completeProjectCreation(outcome);
        });
      },
    }),
    [applyWithBusyState, completeProjectCreation, runDeployment]
  );

  const handleGithubDeploy = useCallback(
    async (repo: GithubDeployerRepo) => {
      await applyWithBusyState(async () => {
        const outcome = await runDeployment({
          kind: "github",
          repository: repo,
          target: newProjectDeploymentTarget(),
        });
        if (outcome.kind !== "github") {
          return;
        }
        toast.success(outcome.taskMessage);
        setLastConfirmedKind(
          `github:${outcome.sourceLabel}:${outcome.projectName}`
        );
        dispatchCreationPaneState({ type: "close" });
        await completeProjectCreation(outcome);
      });
    },
    [applyWithBusyState, completeProjectCreation, runDeployment]
  );

  const handleGithubDisconnect = useCallback(async () => {
    try {
      await disconnectGithubAuth();
      await mutateGithubRepos([], { revalidate: false });
      toast.success("Disconnected GitHub.");
    } catch (error) {
      toastErrorDetail(
        "Could not disconnect GitHub.",
        errorDescription(error, "Could not disconnect GitHub.")
      );
      throw error;
    }
  }, [disconnectGithubAuth, mutateGithubRepos]);

  const handleGithubTemplateDeploy = useCallback(
    async (input: {
      repo: GithubDeployerRepo;
      settings: TemplateDeploymentSettings;
      template: (typeof catalogTemplates)[number];
    }) => {
      const matchedTemplate = findTemplateForGithubRepo({
        repo: input.repo,
        templates: catalogTemplates,
      });
      if (
        matchedTemplate?.name !== input.template.name ||
        matchedTemplate.name !== input.settings.templateName ||
        !templateCanDeployWithDefaults(matchedTemplate)
      ) {
        toast.error("Template recommendation is no longer valid.");
        return;
      }
      await applyWithBusyState(async () => {
        const outcome = await runDeployment({
          args: input.settings.args,
          kind: "template",
          sensitiveKeys: input.settings.sensitiveKeys,
          target: newProjectDeploymentTarget(),
          templateName: input.settings.templateName,
        });
        if (outcome.kind !== "template") {
          return;
        }
        toast.success(outcome.taskMessage);
        setLastConfirmedKind(
          `template:${input.template.name}:${outcome.projectName}`
        );
        dispatchCreationPaneState({ type: "close" });
        await completeProjectCreation(outcome);
      });
    },
    [
      applyWithBusyState,
      completeProjectCreation,
      runDeployment,
      catalogTemplates,
    ]
  );

  const githubDeployer = useMemo(
    () => ({
      actions: {
        onAuthorize: initiateGithubAuth,
        onDisconnect: handleGithubDisconnect,
        onDeploy: handleGithubDeploy,
        onDeployTemplate: handleGithubTemplateDeploy,
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
        templateOptionsLoading: templateCatalog.isLoading,
        templateOptions: templateCatalog.templates,
      },
    }),
    [
      githubDeployerLoading,
      githubReposError,
      githubRepos,
      githubAuthorized,
      handleGithubDisconnect,
      handleGithubDeploy,
      handleGithubTemplateDeploy,
      initiateGithubAuth,
      mutateGithubRepos,
      templateCatalog.isLoading,
      templateCatalog.templates,
    ]
  );

  const creatorRootProps = useMemo(
    () => ({
      actions,
      confirmApplying,
      databaseOptions,
      enabledSources: CREATION_PANE_SOURCES,
      githubDeployer,
      ...(creationPaneState.entryMode === "templateDirect" &&
      creationPaneState.templateName != null
        ? { initialTemplateName: creationPaneState.templateName }
        : {}),
      ...(creationPaneState.entryMode === "templateDirect" &&
      creationPaneState.templateArgs != null
        ? { initialTemplateArgs: creationPaneState.templateArgs }
        : {}),
      templateOptions: templateCatalog.templates,
      ...(templateCatalog.error?.message == null
        ? {}
        : { templateOptionsError: templateCatalog.error.message }),
      templateOptionsLoading: templateCatalog.isLoading,
    }),
    [
      actions,
      confirmApplying,
      databaseOptions,
      githubDeployer,
      creationPaneState.entryMode,
      creationPaneState.templateArgs,
      creationPaneState.templateName,
      templateCatalog.error,
      templateCatalog.isLoading,
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
