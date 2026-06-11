"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  GithubDeployerActions,
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
      onDeploy: actions.onDeploy,
    }),
    [actions.onAuthorize, actions.onDeploy]
  );

  const value = useMemo(
    (): GithubDeployerValue => ({
      actions: resolvedActions,
      selectedRepoId,
      setSelectedRepoId,
      states,
    }),
    [resolvedActions, selectedRepoId, states]
  );

  return (
    <GithubDeployerContext.Provider value={value}>
      <div className="w-full min-w-0" data-slot="github-deployer-root">
        {children}
      </div>
    </GithubDeployerContext.Provider>
  );
}

GithubDeployerRoot.displayName = "GithubDeployer.Root";
