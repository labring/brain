/**
 * The partial unique index `github_oauth_connections_current_owner_unique_idx`
 * and its upsert arbiter both key on this value, so bumping it requires a new
 * drizzle migration to recreate the index.
 *
 * Generation 2 keys ownership by the global `userUid` (ADR-0059).
 */
export const CURRENT_GITHUB_OWNER_IDENTITY_VERSION = 2;

/**
 * Generation 1 keyed ownership by the per-region crName (ADR-0056). Its rows
 * are adopted lazily: a verified connection entry request re-keys the actor's
 * legacy row to the uid and upgrades it to the current generation.
 */
export const LEGACY_GITHUB_OWNER_IDENTITY_VERSION = 1;

export interface GithubConnectionOwnerIdentity {
  namespace: string;
  ownerIdentityVersion: number;
  /**
   * The owning platform account's global `userUid`, stored in the
   * `workspace_actor` column. The per-region crName never enters uid-keyed
   * rows (ADR-0059).
   */
  userUid: string;
}
