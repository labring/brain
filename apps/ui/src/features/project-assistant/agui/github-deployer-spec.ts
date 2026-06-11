import type { GithubDeployerRepo } from "@/features/deployment/github-deployer/github-deployer.types";

import { executeEmitGenUISpec } from "./gen-ui-tool";

/** `executeEmitGenUISpec` input shape (tool + validator). */
export function buildGithubDeployerDeployedAguiExecuteInput(
  deployedRepo: GithubDeployerRepo
) {
  return {
    spec: {
      root: "GithubDeployer",
      elements: {
        GithubDeployer: {
          type: "GithubDeployer",
          props: { deployedRepo },
          children: [] as string[],
        },
      },
    },
  } as const;
}

/** Validated json-render spec: GithubDeployer completed UI with **only** `deployedRepo`. */
export function githubDeployerDeployedAguiSpec(
  deployedRepo: GithubDeployerRepo
) {
  const result = executeEmitGenUISpec(
    buildGithubDeployerDeployedAguiExecuteInput(deployedRepo)
  );
  if (!result.ok) {
    throw new Error(result.validationMessage);
  }
  return result.spec;
}
