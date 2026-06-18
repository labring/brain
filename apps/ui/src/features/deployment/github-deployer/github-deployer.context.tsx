"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  defaultTemplateArgs,
  findTemplateForGithubRepo,
  templateCanDeployWithDefaults,
} from "../github-template-match";
import type {
  GithubDeployerActions,
  GithubDeployerRepo,
  GithubDeployerStates,
  GithubDeployerValue,
} from "./github-deployer.types";

export const GithubDeployerContext = createContext<GithubDeployerValue | null>(
  null
);

export function useGithubDeployer(): GithubDeployerValue {
  const value = useContext(GithubDeployerContext);
  if (!value) {
    throw new Error(
      "GithubDeployer: useGithubDeployer must be used within GithubDeployer.Root"
    );
  }
  return value;
}

export function GithubDeployerRoot({
  actions = {},
  children,
  states,
}: {
  actions?: GithubDeployerActions;
  children?: ReactNode;
  states: GithubDeployerStates;
}) {
  const [selectedRepoId, setSelectedRepoId] = useState(
    () => states.repos[0]?.id ?? ""
  );
  const [pendingRecommendation, setPendingRecommendation] = useState<{
    repo: GithubDeployerRepo;
    template: NonNullable<GithubDeployerStates["templateOptions"]>[number];
  } | null>(null);
  const [recommendationSubmitting, setRecommendationSubmitting] = useState<
    "github" | "template" | null
  >(null);

  useEffect(() => {
    setSelectedRepoId((prev) => {
      if (states.repos.some((r) => r.id === prev)) {
        return prev;
      }
      return states.repos[0]?.id ?? "";
    });
  }, [states.repos]);

  const resolvedActions = useMemo(
    () => ({
      onAuthorize: actions.onAuthorize,
      onDisconnect: actions.onDisconnect,
      onDeploy: actions.onDeploy,
      onDeployTemplate: actions.onDeployTemplate,
    }),
    [
      actions.onAuthorize,
      actions.onDeploy,
      actions.onDeployTemplate,
      actions.onDisconnect,
    ]
  );

  const requestDeploy = useMemo(
    () => (repo: GithubDeployerRepo) => {
      const template =
        resolvedActions.onDeployTemplate == null
          ? null
          : findTemplateForGithubRepo({
              repo,
              templates: states.templateOptions ?? [],
            });
      if (template != null && templateCanDeployWithDefaults(template)) {
        setPendingRecommendation({ repo, template });
        return;
      }
      resolvedActions.onDeploy?.(repo);
    },
    [resolvedActions, states.templateOptions]
  );

  const value = useMemo(
    (): GithubDeployerValue => ({
      actions: resolvedActions,
      requestDeploy,
      selectedRepoId,
      setSelectedRepoId,
      states,
    }),
    [requestDeploy, resolvedActions, selectedRepoId, states]
  );

  const recommendedTemplateLabel =
    pendingRecommendation?.template.title ||
    pendingRecommendation?.template.name ||
    "Template";
  const recommendedRepoLabel =
    pendingRecommendation?.repo.fullName ??
    pendingRecommendation?.repo.name ??
    "this repository";
  const deployPendingRecommendation = useCallback(
    async (mode: "github" | "template") => {
      if (pendingRecommendation == null || recommendationSubmitting != null) {
        return;
      }
      setRecommendationSubmitting(mode);
      try {
        if (mode === "github") {
          await resolvedActions.onDeploy?.(pendingRecommendation.repo);
        } else {
          await resolvedActions.onDeployTemplate?.({
            repo: pendingRecommendation.repo,
            settings: {
              args: defaultTemplateArgs(pendingRecommendation.template),
              templateName: pendingRecommendation.template.name,
            },
            template: pendingRecommendation.template,
          });
        }
        setPendingRecommendation(null);
      } finally {
        setRecommendationSubmitting(null);
      }
    },
    [pendingRecommendation, recommendationSubmitting, resolvedActions]
  );

  const recommendationActionDisabled = recommendationSubmitting != null;

  return (
    <GithubDeployerContext.Provider value={value}>
      <div className="w-full min-w-0" data-slot="github-deployer-root">
        {children}
      </div>
      <AppDialog.Root
        onOpenChange={(open) => {
          if (!open) {
            setPendingRecommendation(null);
          }
        }}
        open={pendingRecommendation != null}
      >
        <AppDialog.Content data-slot="github-template-recommendation-dialog">
          <AppDialog.Header>
            <AppDialog.Icon />
            <AppDialog.Title>Use existing template?</AppDialog.Title>
          </AppDialog.Header>
          <AppDialog.Body>
            <AppDialog.Description>
              {recommendedRepoLabel} matches {recommendedTemplateLabel} in the
              app store. Templates deploy with defaults and usually finish
              faster than analyzing the repository.
            </AppDialog.Description>
          </AppDialog.Body>
          <AppDialog.Footer>
            <AppDialog.Action
              disabled={
                states.isLoading ||
                recommendationActionDisabled ||
                resolvedActions.onDeploy == null
              }
              loading={recommendationSubmitting === "github"}
              onClick={() => {
                deployPendingRecommendation("github").catch(() => undefined);
              }}
            >
              Continue with GitHub
            </AppDialog.Action>
            <AppDialog.Action
              disabled={states.isLoading || recommendationActionDisabled}
              loading={recommendationSubmitting === "template"}
              onClick={() => {
                deployPendingRecommendation("template").catch(() => undefined);
              }}
            >
              Use Template
            </AppDialog.Action>
          </AppDialog.Footer>
        </AppDialog.Content>
      </AppDialog.Root>
    </GithubDeployerContext.Provider>
  );
}

GithubDeployerRoot.displayName = "GithubDeployer.Root";
