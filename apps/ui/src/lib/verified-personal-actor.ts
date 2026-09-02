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
  /**
   * Platform account id from the verified token binding, needed by
   * account-service calls made on the actor's behalf (ADR-0060/0065).
   * Optional because it is not part of the actor's identity: absent or null
   * (bindings minted before the claim existed), account-service callers fail
   * open. Never part of the owner key.
   */
  accountUserId?: string | null;
  legacyWorkspaceActor: string;
  owner: Owner;
}

/** Map the choke point's verified binding onto the personal-resource actor shape. */
export function verifiedPersonalResourceActor(
  authorization: VerifiedWorkspaceActorAuthorization
): VerifiedPersonalResourceActor {
  return {
    accountUserId: authorization.actorBinding.userId,
    legacyWorkspaceActor: authorization.workspaceActor,
    owner: {
      namespace: authorization.namespace,
      userUid: authorization.actorBinding.userUid,
    },
  };
}
