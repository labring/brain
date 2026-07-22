/**
 * The partial unique index `github_oauth_connections_current_owner_unique_idx`
 * and its upsert arbiter both key on this value, so bumping it requires a new
 * drizzle migration to recreate the index.
 */
export const CURRENT_GITHUB_OWNER_IDENTITY_VERSION = 1;

export interface GithubConnectionOwnerIdentity {
  namespace: string;
  ownerIdentityVersion: number;
  workspaceActor: string;
}
