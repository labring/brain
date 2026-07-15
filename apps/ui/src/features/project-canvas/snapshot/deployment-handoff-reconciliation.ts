import {
  DEPLOYMENT_UNKNOWN_SLOT_ID,
  deploymentProjectionPlacementOwner,
} from "../layout/placement-owner";
import type {
  CanvasLayoutPosition,
  CanvasLayoutResourceRef,
  CanvasPlacementSource,
} from "../layout/types";
import { canvasResourceKey } from "../nodes/resource-identity";
import {
  type DeploymentProjectionContext,
  deploymentProjectionPlacementFromContext,
  layoutHasRefInDeploymentProjectionContext,
  resultRefHasLiveNodeInDeploymentProjectionContext,
} from "./deployment-projection-context";
import {
  materializedSlotPositions,
  resultRefForSlot,
} from "./deployment-projection-model";

export interface DeploymentHandoffCandidate {
  owner: ReturnType<typeof deploymentProjectionPlacementOwner>;
  position: CanvasLayoutPosition | undefined;
  source: CanvasPlacementSource | undefined;
}

export interface DeploymentHandoffReconciliation {
  candidates: DeploymentHandoffCandidate[];
  conflict: boolean;
  position: CanvasLayoutPosition | undefined;
  ref: CanvasLayoutResourceRef;
  resourceAlreadyPlaced: boolean;
  selectedOwner: DeploymentHandoffCandidate["owner"] | undefined;
  source: CanvasPlacementSource | undefined;
}

function positionKey(position: CanvasLayoutPosition): string {
  return `${position.x}:${position.y}`;
}

function compareCandidates(
  left: DeploymentHandoffCandidate,
  right: DeploymentHandoffCandidate
): number {
  return (
    left.owner.taskId.localeCompare(right.owner.taskId) ||
    left.owner.slotId.localeCompare(right.owner.slotId)
  );
}

function selectCandidate(candidates: DeploymentHandoffCandidate[]): {
  candidate: DeploymentHandoffCandidate | undefined;
  conflict: boolean;
} {
  const positioned = candidates.filter(
    (
      candidate
    ): candidate is DeploymentHandoffCandidate & {
      position: CanvasLayoutPosition;
    } => candidate.position !== undefined
  );
  const userCandidates = positioned.filter(
    (candidate) => candidate.source === "user"
  );
  const eligible = userCandidates.length > 0 ? userCandidates : positioned;
  const positions = new Set(
    eligible.map((candidate) => positionKey(candidate.position))
  );
  if (positions.size > 1) {
    return { candidate: undefined, conflict: true };
  }
  return {
    candidate: [...eligible].sort(compareCandidates)[0],
    conflict: false,
  };
}

export function deploymentHandoffReconciliations(
  context: DeploymentProjectionContext
): ReadonlyMap<string, DeploymentHandoffReconciliation> {
  const candidatesByRef = new Map<
    string,
    { candidates: DeploymentHandoffCandidate[]; ref: CanvasLayoutResourceRef }
  >();

  for (const { preview, task } of context.previews) {
    const materialized = materializedSlotPositions({
      layout: context.layout,
      slots: preview.slots,
      task,
    });
    const unknownPlacement = deploymentProjectionPlacementFromContext(context, {
      slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
      taskId: task.id,
    });
    for (const slot of preview.slots) {
      const ref = resultRefForSlot({ slot, task });
      if (
        ref === undefined ||
        !(
          layoutHasRefInDeploymentProjectionContext(context, ref) ||
          resultRefHasLiveNodeInDeploymentProjectionContext(context, ref)
        )
      ) {
        continue;
      }
      const placement = deploymentProjectionPlacementFromContext(context, {
        slotId: slot.id,
        taskId: task.id,
      });
      const candidate: DeploymentHandoffCandidate = {
        owner: deploymentProjectionPlacementOwner({
          slotId: slot.id,
          taskId: task.id,
        }),
        position:
          placement?.position ??
          (unknownPlacement === undefined
            ? undefined
            : materialized.positions.get(slot.id)),
        source: placement?.source ?? unknownPlacement?.source,
      };
      const key = canvasResourceKey(ref);
      const group = candidatesByRef.get(key);
      if (group === undefined) {
        candidatesByRef.set(key, { candidates: [candidate], ref });
      } else {
        group.candidates.push(candidate);
      }
    }
  }

  return new Map(
    [...candidatesByRef.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, group]) => {
        const candidates = [...group.candidates].sort(compareCandidates);
        const selected = selectCandidate(candidates);
        return [
          key,
          {
            candidates,
            conflict: selected.conflict,
            position: selected.candidate?.position,
            ref: group.ref,
            resourceAlreadyPlaced: layoutHasRefInDeploymentProjectionContext(
              context,
              group.ref
            ),
            selectedOwner: selected.candidate?.owner,
            source:
              selected.candidate === undefined
                ? undefined
                : (selected.candidate.source ?? "generated"),
          },
        ];
      })
  );
}
