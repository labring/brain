"use client";

import { useAtomValue } from "jotai";
import { UsersRound } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import type { SessionWorkspace } from "@/features/session/session-schema";
import { AreaShell } from "@/features/shell/area-shell";
import {
  currentWorkspaceAtom,
  desktopDomainAtom,
  kubeconfigAtom,
  sessionUserAtom,
} from "@/lib/auth-store";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";

import { useWorkspaceActions } from "./use-workspace-actions";
import { useWorkspaceDetails } from "./use-workspace-details";
import { useWorkspaceList } from "./use-workspace-list";
import { useWorkspacePlans } from "./use-workspace-plans";
import { WorkspaceAreaList } from "./workspace-area-list";
import { resolveManagedWorkspace } from "./workspace-area-route-core";
import { WorkspaceDetailHeader } from "./workspace-detail-header";
import {
  gateWorkspaceActions,
  type WorkspaceGateInput,
} from "./workspace-gating-core";
import { WorkspaceMembersPanel } from "./workspace-members-panel";
import { planNameFor } from "./workspace-plan-slot";
import { readWorkspaceReturnRoute } from "./workspace-return-route";

/** The area's icon: the members glyph, in the title bar's accent. */
function WorkspaceAreaIcon() {
  return (
    <UsersRound
      aria-hidden
      className="size-4 shrink-0 text-blue-400"
      strokeWidth={2}
    />
  );
}

/**
 * Desktop's cloud domain for the links the area builds (spec §B.2): the
 * SDK host config inside the iframe, else the kubeconfig's routing domain
 * (the card-management route derives it the same way server-side).
 */
function useDesktopCloudDomain(): string {
  const desktopDomain = useAtomValue(desktopDomainAtom).trim();
  const kubeconfig = useAtomValue(kubeconfigAtom);
  return useMemo(
    () =>
      desktopDomain === ""
        ? routingDomainFromKubeconfig(kubeconfig)
        : desktopDomain,
    [desktopDomain, kubeconfig]
  );
}

/**
 * The Managed Workspace's detail column (spec §D.4–D.5): the header from
 * the list's own entry (name, role, Personal are the list's verdict), the
 * members from `POST /api/workspace/details`, and the writes with their
 * convergence behind every control.
 */
function WorkspaceDetail({
  isCurrent,
  meCrName,
  onGone,
  planName,
  workspace,
}: {
  isCurrent: boolean;
  meCrName: string;
  /** The Workspace was deleted or left: the area moves on. */
  onGone: (uid: string) => void;
  planName: string | null | undefined;
  workspace: SessionWorkspace;
}) {
  const details = useWorkspaceDetails(workspace.uid);
  const members = details.data?.members;
  const uid = workspace.uid;
  const actions = useWorkspaceActions({
    onGone: useCallback(() => onGone(uid), [onGone, uid]),
    workspace,
  });
  const cloudDomain = useDesktopCloudDomain();
  const gateInput: WorkspaceGateInput = useMemo(
    () => ({
      actorRole: workspace.role,
      isCurrent,
      isPersonal: workspace.isPersonal,
      // The member count is the one fact the gates wait on; the ⋯ menu
      // stays closed until it is known, so no verdict is guessed.
      memberCount: members?.length ?? 0,
    }),
    [isCurrent, members, workspace.isPersonal, workspace.role]
  );
  const gates = gateWorkspaceActions(gateInput);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 px-4 pt-4"
      data-slot="workspace-detail"
    >
      <WorkspaceDetailHeader
        actions={actions}
        gates={gates}
        isCurrent={isCurrent}
        meCrName={meCrName}
        members={members}
        planName={planName}
        workspace={workspace}
      />
      <WorkspaceMembersPanel
        actions={actions}
        cloudDomain={cloudDomain}
        error={details.error}
        gateInput={gateInput}
        inviteGate={gates.invite}
        meCrName={meCrName}
        members={members}
        workspace={workspace}
      />
    </div>
  );
}

/**
 * The Workspace Area (spec §D, CONTEXT.md): the list of every Workspace
 * the user belongs to beside the detail of the Managed Workspace the URL
 * names. `/workspace` replaces itself with the current Workspace; a uid
 * outside the list falls back to it with a notice (§D.1). Selecting a
 * row never switches the current Workspace. The shell's close button
 * returns to the address recorded on the way in — home on a URL-direct
 * entry.
 */
export function WorkspaceArea() {
  const params = useParams<{ uid?: string }>();
  const router = useRouter();
  const current = useAtomValue(currentWorkspaceAtom);
  const user = useAtomValue(sessionUserAtom);
  const workspaces = useWorkspaceList();
  const workspaceIds = useMemo(
    () => workspaces.map((workspace) => workspace.id),
    [workspaces]
  );
  const plans = useWorkspacePlans(workspaceIds);

  const uid = params.uid ?? null;
  const resolution = resolveManagedWorkspace({
    currentUid: current?.uid ?? null,
    uid,
    workspaces,
  });
  const redirectTo = resolution.kind === "redirect" ? resolution.to : null;
  const notice = resolution.kind === "redirect" ? resolution.notice : null;
  // One notice per unknown uid, whatever React's effect cadence.
  const noticedUid = useRef<string | null>(null);
  // A Workspace the actor just deleted or left (spec §D.8): the page is
  // already on its way to the current one, so the list's re-read finding
  // the uid gone is no surprise and earns no notice or second navigation.
  const departedUid = useRef<string | null>(null);
  const currentUid = current?.uid ?? null;
  const handleGone = useCallback(
    (goneUid: string) => {
      departedUid.current = goneUid;
      if (currentUid != null) {
        router.replace(`/workspace/${currentUid}`);
      }
    },
    [currentUid, router]
  );
  useEffect(() => {
    if (redirectTo == null || (uid != null && departedUid.current === uid)) {
      return;
    }
    router.replace(redirectTo);
    if (notice != null && noticedUid.current !== uid) {
      noticedUid.current = uid;
      toast(notice);
    }
  }, [notice, redirectTo, router, uid]);

  const managed = resolution.kind === "managed" ? resolution.workspace : null;

  return (
    <AreaShell
      aside={
        <WorkspaceAreaList
          currentUid={current?.uid ?? null}
          managedUid={managed?.uid ?? null}
          workspaces={workspaces}
        />
      }
      asideClassName="lg:w-60"
      closeLabel="Close workspaces"
      icon={<WorkspaceAreaIcon />}
      readReturnRoute={readWorkspaceReturnRoute}
      slot="workspace-area-shell"
      title="Workspaces"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {managed == null || current == null ? null : (
          <WorkspaceDetail
            isCurrent={managed.uid === current.uid}
            key={managed.uid}
            meCrName={user?.crName ?? ""}
            onGone={handleGone}
            planName={planNameFor(plans, managed.id)}
            workspace={managed}
          />
        )}
      </div>
    </AreaShell>
  );
}
