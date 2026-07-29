import type { WorkspaceActorAuthorization } from "./request-kubeconfig-auth";

/** The success branch of the workspace-actor authorization choke point. */
export type VerifiedWorkspaceActorAuthorization = Extract<
  WorkspaceActorAuthorization,
  { ok: true }
>;

/**
 * Owner key of a uid-keyed personal resource (ADR-0059): the workspace
 * namespace plus the owning platform account's global `userUid`. The
 * per-region crName never enters uid-keyed rows.
 */
export interface PersonalResourceOwner {
  namespace: string;
  userUid: string;
}

/**
 * A verified actor entering a personal-resource route: the uid-keyed owner
 * plus the per-region crName, which is used only to find that actor's legacy
 * rows.
 */
export interface VerifiedPersonalResourceActor<
  Owner extends PersonalResourceOwner = PersonalResourceOwner,
> {
  legacyWorkspaceActor: string;
  owner: Owner;
}

/** Map the choke point's verified binding onto the personal-resource actor shape. */
export function verifiedPersonalResourceActor(
  authorization: VerifiedWorkspaceActorAuthorization
): VerifiedPersonalResourceActor {
  return {
    legacyWorkspaceActor: authorization.workspaceActor,
    owner: {
      namespace: authorization.namespace,
      userUid: authorization.actorBinding.userUid,
    },
  };
}
