"use client";

import { useAtomValue } from "jotai";
import { UsersRound } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import type { SessionWorkspace } from "@/features/session/session-schema";
import { AreaShell } from "@/features/shell/area-shell";
import { currentWorkspaceAtom, sessionUserAtom } from "@/lib/auth-store";

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
import { readWorkspaceReturnRoute } from "./workspace-return-route";

/** The area's icon; matches the Manage Workspaces row of the Switcher. */
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
 * The Managed Workspace's detail column (spec §D.4–D.5): the header from
 * the list's own entry (name, role, Personal are the list's verdict), the
 * members from `POST /api/workspace/details`.
 */
function WorkspaceDetail({
  isCurrent,
  meCrName,
  planName,
  workspace,
}: {
  isCurrent: boolean;
  meCrName: string;
  planName: string | null | undefined;
  workspace: SessionWorkspace;
}) {
  const details = useWorkspaceDetails(workspace.uid);
  const members = details.data?.members;
  const gateInput: WorkspaceGateInput = useMemo(
    () => ({
      actorRole: workspace.role,
      isCurrent,
      isPersonal: workspace.isPersonal,
      // The member count is the one fact the gates wait on; until the
      // members land, transfer is judged as if there were someone to
      // transfer to (Desktop is the authority either way).
      memberCount: members?.length ?? 2,
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
        gates={gates}
        isCurrent={isCurrent}
        planName={planName}
        workspace={workspace}
      />
      <WorkspaceMembersPanel
        error={details.error}
        gateInput={gateInput}
        inviteGate={gates.invite}
        meCrName={meCrName}
        members={members}
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
  useEffect(() => {
    if (redirectTo == null) {
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
            planName={plans == null ? undefined : (plans[managed.id] ?? null)}
            workspace={managed}
          />
        )}
      </div>
    </AreaShell>
  );
}
