"use client";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@workspace/ui/components/dialog";
import type {
  SettingsLeaveGuardAction,
  SettingsLeaveGuardDecision,
  SettingsLeaveGuardHandle,
  SettingsLeaveGuardRegistration,
  SettingsLeaveGuardScope,
} from "@workspace/ui/lib/settings-leave-guard";
import { Save } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  continueSidePaneLeave,
  shouldPromptSidePaneLeave,
} from "@/features/project-surfaces/leave-guard";

export type {
  SettingsLeaveGuardAction,
  SettingsLeaveGuardDecision,
  SettingsLeaveGuardHandle,
  SettingsLeaveGuardRegistration,
  SettingsLeaveGuardScope,
} from "@workspace/ui/lib/settings-leave-guard";

interface PendingSettingsLeave {
  action: SettingsLeaveGuardAction;
  continueLeave: () => void;
  guard: SettingsLeaveGuardHandle;
}

export type SettingsLeaveResult =
  | { status: "blocked"; error: unknown }
  | { status: "continued" }
  | { status: "stayed" };

export function shouldPromptSettingsLeave(
  guard: SettingsLeaveGuardHandle | null | undefined
) {
  return shouldPromptSidePaneLeave(guard);
}

export function continueSettingsLeave({
  decision,
  guard,
  onContinue,
}: {
  decision: SettingsLeaveGuardDecision;
  guard: SettingsLeaveGuardHandle;
  onContinue: () => Promise<void> | void;
}): Promise<SettingsLeaveResult> {
  return continueSidePaneLeave({ decision, guard, onContinue });
}

function settingsLeaveGuardTitle(scope: SettingsLeaveGuardScope) {
  switch (scope) {
    case "database":
      return "Unsaved database configuration changes";
    case "publicAddresses":
      return "Unsaved Public Address changes";
    default:
      return "Unsaved AP Settings changes";
  }
}

function settingsLeaveGuardDescription(action: SettingsLeaveGuardAction) {
  return action === "close"
    ? "Save the current draft, discard it, or stay on this settings panel."
    : "Save the current draft, discard it, or stay on this settings panel before switching resources.";
}

export function SettingsLeaveGuardDialog({
  action,
  guard,
  onDecision,
  open,
  pending,
}: {
  action: SettingsLeaveGuardAction;
  guard: SettingsLeaveGuardHandle | null;
  onDecision: (decision: SettingsLeaveGuardDecision) => void;
  open: boolean;
  pending: boolean;
}) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onDecision("stay");
        }
      }}
      open={open}
    >
      <DialogContent showCloseButton={false}>
        <SettingsLeaveGuardDialogContent
          action={action}
          guard={guard}
          onDecision={onDecision}
          pending={pending}
        />
      </DialogContent>
    </Dialog>
  );
}

export function SettingsLeaveGuardDialogContent({
  action,
  guard,
  onDecision,
  pending,
}: {
  action: SettingsLeaveGuardAction;
  guard: SettingsLeaveGuardHandle | null;
  onDecision: (decision: SettingsLeaveGuardDecision) => void;
  pending: boolean;
}) {
  const saveDisabled = pending || guard?.canSave === false;

  return (
    <>
      <DialogHeader>
        <h2 className="font-medium leading-none">
          {settingsLeaveGuardTitle(guard?.scope ?? "ap")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {settingsLeaveGuardDescription(action)}
        </p>
      </DialogHeader>
      <DialogFooter className="flex-col-reverse sm:flex-row">
        <Button
          disabled={pending}
          onClick={() => onDecision("stay")}
          type="button"
          variant="ghost"
        >
          Stay
        </Button>
        <Button
          disabled={pending}
          onClick={() => onDecision("discard")}
          type="button"
          variant="outline"
        >
          Discard
        </Button>
        <Button
          disabled={saveDisabled}
          onClick={() => onDecision("save")}
          type="button"
          variant="secondary"
        >
          <Save aria-hidden data-icon="inline-start" />
          {pending ? "Saving" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function useSettingsLeaveGuardController() {
  const guardRef = useRef<SettingsLeaveGuardHandle | null>(null);
  const [prompt, setPrompt] = useState<PendingSettingsLeave | null>(null);
  const [pending, setPending] = useState(false);

  const registerSettingsLeaveGuard =
    useCallback<SettingsLeaveGuardRegistration>((guard) => {
      guardRef.current = guard;
    }, []);

  const requestSettingsLeave = useCallback(
    (action: SettingsLeaveGuardAction, continueLeave: () => void) => {
      const guard = guardRef.current;
      if (guard == null || !shouldPromptSettingsLeave(guard)) {
        continueLeave();
        return;
      }
      setPrompt({ action, continueLeave, guard });
    },
    []
  );

  const resolvePrompt = useCallback(
    async (decision: SettingsLeaveGuardDecision) => {
      const current = prompt;
      if (current == null || pending) {
        return;
      }

      if (decision === "stay") {
        setPrompt(null);
        return;
      }

      setPending(true);
      const result = await continueSettingsLeave({
        decision,
        guard: current.guard,
        onContinue: current.continueLeave,
      });
      setPending(false);

      if (result.status !== "blocked") {
        setPrompt(null);
        return;
      }

      setPrompt(null);
    },
    [pending, prompt]
  );

  const settingsLeaveGuardDialog = useMemo(
    () => (
      <SettingsLeaveGuardDialog
        action={prompt?.action ?? "close"}
        guard={prompt?.guard ?? null}
        onDecision={(decision) => {
          resolvePrompt(decision).catch(() => undefined);
        }}
        open={prompt != null}
        pending={pending}
      />
    ),
    [pending, prompt, resolvePrompt]
  );

  return {
    registerSettingsLeaveGuard,
    requestSettingsLeave,
    settingsLeaveGuardDialog,
  };
}
