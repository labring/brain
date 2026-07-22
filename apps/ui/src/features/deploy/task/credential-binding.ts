import { CURRENT_GITHUB_OWNER_IDENTITY_VERSION } from "../github/owner-identity";
import {
  CURRENT_DEPLOYMENT_CREDENTIAL_BINDING_VERSION,
  type DeploymentCredentialBinding,
  type DeploymentTaskSource,
} from "./schema";

export interface DeploymentCredentialTokenLookupInput {
  connectionRef: string;
  credentialOwner: string;
  namespace: string;
  ownerIdentityVersion: number;
}

export type DeploymentCredentialTokenLookup = (
  input: DeploymentCredentialTokenLookupInput
) => Promise<string | null>;

interface DeploymentTaskCredentialRecord {
  credentialBinding: DeploymentCredentialBinding | null;
  namespace: string;
  source: DeploymentTaskSource;
}

export function isCurrentDeploymentCredentialBinding(
  binding: DeploymentCredentialBinding | null | undefined
): binding is DeploymentCredentialBinding {
  return (
    binding != null &&
    binding.version === CURRENT_DEPLOYMENT_CREDENTIAL_BINDING_VERSION &&
    binding.connectionRef.trim() !== "" &&
    binding.credentialOwner.trim() !== ""
  );
}

function requiredBinding(
  task: DeploymentTaskCredentialRecord
): DeploymentCredentialBinding {
  const binding = task.credentialBinding;
  if (!isCurrentDeploymentCredentialBinding(binding)) {
    throw new Error(
      "A current Deployment Credential Binding is required for GitHub deployment."
    );
  }
  return binding;
}

/** Resolve a GitHub runner token exclusively from the task's persisted binding. */
export async function resolveGithubTokenForDeploymentTask(
  task: DeploymentTaskCredentialRecord,
  lookup: DeploymentCredentialTokenLookup
): Promise<string | null> {
  if (task.source.kind !== "github") {
    return null;
  }
  const binding = requiredBinding(task);
  const token = await lookup({
    connectionRef: binding.connectionRef,
    credentialOwner: binding.credentialOwner,
    namespace: task.namespace,
    ownerIdentityVersion: CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
  });
  if (token == null) {
    throw new Error(
      "GitHub OAuth connection is not authorized for this deployment."
    );
  }
  return token;
}
