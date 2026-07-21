export const CURRENT_GITHUB_OWNER_IDENTITY_VERSION = 1;

export interface GithubConnectionOwnerIdentity {
  namespace: string;
  ownerIdentityVersion: number;
  workspaceActor: string;
}
