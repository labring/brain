export type SidePaneLeaveAction = "close" | "replace";
export type SidePaneLeaveDecision = "discard" | "save" | "stay";

export interface SidePaneLeaveGuard {
  canSave?: boolean;
  dirty: boolean;
  discard: () => Promise<void> | void;
  save: () => Promise<void> | void;
}

export type SidePaneLeaveGuardRegistration = (
  guard: SidePaneLeaveGuard | null
) => void;

export type SidePaneLeaveResult =
  | { status: "blocked"; error: unknown }
  | { status: "continued" }
  | { status: "stayed" };

export function shouldPromptSidePaneLeave(
  guard: SidePaneLeaveGuard | null | undefined
) {
  return guard?.dirty === true;
}

export async function continueSidePaneLeave({
  decision,
  guard,
  onContinue,
}: {
  decision: SidePaneLeaveDecision;
  guard: SidePaneLeaveGuard;
  onContinue: () => Promise<void> | void;
}): Promise<SidePaneLeaveResult> {
  switch (decision) {
    case "stay":
      return { status: "stayed" };
    case "discard":
      await guard.discard();
      await onContinue();
      return { status: "continued" };
    case "save":
      if (guard.canSave === false) {
        return {
          error: new Error("Side Pane cannot be saved yet."),
          status: "blocked",
        };
      }
      try {
        await guard.save();
        await onContinue();
        return { status: "continued" };
      } catch (error) {
        return { error, status: "blocked" };
      }
    default:
      return {
        error: new Error("Unknown Side Pane leave decision."),
        status: "blocked",
      };
  }
}
