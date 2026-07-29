import {
  type PersonalResourceOwner,
  type VerifiedPersonalResourceActor,
  type VerifiedWorkspaceActorAuthorization,
  verifiedPersonalResourceActor,
} from "@/lib/verified-personal-actor";

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

/**
 * Owner key of a GitHub Connection: the uid-keyed personal-resource owner
 * (`userUid` lives in the legacy-named `workspace_actor` column) plus the
 * identity generation it was written under.
 */
export interface GithubConnectionOwnerIdentity extends PersonalResourceOwner {
  ownerIdentityVersion: number;
}

/** A verified actor entering a connection route: the uid-keyed owner plus the per-region crName, which is used only to find that actor's legacy rows. */
export type VerifiedGithubConnectionActor =
  VerifiedPersonalResourceActor<GithubConnectionOwnerIdentity>;

/** Stamp the choke point's verified binding with the current identity generation. */
export function verifiedGithubConnectionActor(
  authorization: VerifiedWorkspaceActorAuthorization
): VerifiedGithubConnectionActor {
  const actor = verifiedPersonalResourceActor(authorization);
  return {
    ...actor,
    owner: {
      ...actor.owner,
      ownerIdentityVersion: CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
    },
  };
}
