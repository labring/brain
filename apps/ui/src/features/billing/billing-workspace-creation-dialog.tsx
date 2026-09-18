"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppInputField } from "@workspace/ui/components/app-input-field";
import { DialogClose } from "@workspace/ui/components/dialog";
import { useStore } from "jotai";
import { X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import type { BillingCredentials } from "@/features/billing/billing-data-client";
import type { BillingPlanSnapshot } from "@/features/billing/billing-plan-data";
import { BillingPlanPicker } from "@/features/billing/billing-plan-picker";
import type { BillingCurrency } from "@/features/billing/config-core";
import { useWorkspaceRefresh } from "@/features/workspace/use-workspace-refresh";
import { WORKSPACE_NAME_MAX_LENGTH } from "@/features/workspace/workspace-write-schema";
import { workspacesAtom } from "@/lib/auth-store";
import { errorDescription } from "@/lib/toast-utils";

import {
  createWorkspaceWithSubscription,
  retryWorkspaceCreationPayment,
  WorkspaceNameConflictError,
} from "./workspace-creation-client";
import {
  WORKSPACE_NAME_ISSUE_MESSAGES,
  type WorkspaceNameIssue,
  workspaceNameIssue,
} from "./workspace-creation-core";
import { recordPendingWorkspaceCreation } from "./workspace-creation-return";
import type {
  CreatedWorkspace,
  WorkspaceCreationPayment,
} from "./workspace-creation-schema";

/**
 * The Billing Area's creation mode (spec §G, CONTEXT "Workspace Creation"):
 * the plan-change dialog's sibling for a Workspace that does not exist yet.
 * The name field and the Plan Picker share one screen; picking a paid plan
 * checks the name and stacks a confirmation over the picker; confirming
 * runs Brain's two steps and hands the top window to Stripe Checkout —
 * a whole-page hop, since the page it returns to belongs to another
 * Workspace. Nothing here is gated by the current Workspace's role or
 * subscription state: anyone signed in may create.
 *
 * A failed second step is an outcome the dialog owns: the Workspace exists,
 * and the confirmation becomes the offer to retry its first payment or
 * leave it Pay-As-You-Go for now.
 */

export interface BillingWorkspaceCreationServices {
  createWorkspace: typeof createWorkspaceWithSubscription;
  /** Where the picker's contact plans send the user (a new tab). */
  openUrl: (url: string) => void;
  /** The whole-page hop to Stripe Checkout (`window.top`, never a new tab). */
  redirectTop: (url: string) => void;
  retryPayment: typeof retryWorkspaceCreationPayment;
}

const DEFAULT_WORKSPACE_CREATION_SERVICES: BillingWorkspaceCreationServices = {
  createWorkspace: createWorkspaceWithSubscription,
  openUrl: (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  redirectTop: (url) => {
    const top = window.top ?? window;
    top.location.href = url;
  },
  retryPayment: retryWorkspaceCreationPayment,
};

// When the confirmation stacks over the picker's dialog, the root backdrop
// already dims the page and the receded picker (see the checkout dialog).
const NESTED_DIALOG_OVERLAY =
  "bg-transparent backdrop-blur-none supports-backdrop-filter:backdrop-blur-none";

type SnapshotPlan = BillingPlanSnapshot["plans"][number];

/**
 * Every plan is new to a Workspace that does not exist: no current plan, no
 * pending change, every paid card reads "Subscribe". Contact plans keep
 * their sales pointer.
 */
function creationPlans(plans: BillingPlanSnapshot["plans"]): SnapshotPlan[] {
  return plans.map((plan) => ({
    ...plan,
    changeKind: plan.changeKind === "contact" ? "contact" : "subscribe",
    isCurrent: false,
  }));
}

interface BillingWorkspaceCreationDialogProps {
  credentials: BillingCredentials;
  currency: BillingCurrency;
  /** The session's Workspace names, for the inline duplicate check. */
  existingWorkspaceNames: readonly string[];
  gpuEnabled: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  plans: BillingPlanSnapshot["plans"];
  regionDomain: string;
  services?: BillingWorkspaceCreationServices;
}

type CreationStage =
  | { kind: "pick" }
  | { kind: "confirm"; plan: SnapshotPlan }
  | {
      error: string;
      kind: "payment-failed";
      plan: SnapshotPlan;
      workspace: CreatedWorkspace;
    };

export function BillingWorkspaceCreationDialog({
  credentials,
  currency,
  existingWorkspaceNames,
  gpuEnabled,
  onOpenChange,
  open,
  plans,
  regionDomain,
  services = DEFAULT_WORKSPACE_CREATION_SERVICES,
}: BillingWorkspaceCreationDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const store = useStore();
  const refreshWorkspaces = useWorkspaceRefresh();
  const [name, setName] = useState("");
  const [nameIssue, setNameIssue] = useState<WorkspaceNameIssue | null>(null);
  // Names Desktop already refused this session: the field says so on the
  // next attempt without another round-trip.
  const [takenNames, setTakenNames] = useState<string[]>([]);
  const [stage, setStage] = useState<CreationStage>({ kind: "pick" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerPlans = useMemo(() => creationPlans(plans), [plans]);
  const trimmedName = name.trim();

  const selectPlan = (planId: string) => {
    const issue = workspaceNameIssue(name, [
      ...existingWorkspaceNames,
      ...takenNames,
    ]);
    setNameIssue(issue);
    if (issue != null) {
      inputRef.current?.focus();
      return;
    }
    const plan = pickerPlans.find((candidate) => candidate.id === planId);
    if (plan == null) {
      return;
    }
    setError(null);
    setStage({ kind: "confirm", plan });
  };

  const handOffToStripe = (
    workspace: CreatedWorkspace,
    payment: Extract<WorkspaceCreationPayment, { status: "started" }>
  ) => {
    recordPendingWorkspaceCreation(workspace.id);
    services.redirectTop(payment.redirectUrl);
  };

  const confirm = async (plan: SnapshotPlan) => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    // The top-level navigation takes a moment to unload the page; the
    // button stays in its submitting state so a second press cannot create
    // a second Workspace in the meantime.
    let handedOff = false;
    try {
      const { payment, workspace } = await services.createWorkspace({
        appToken: credentials.appToken,
        kubeconfig: credentials.kubeconfig,
        name: trimmedName,
        planName: plan.name,
        regionDomain,
      });
      // A Workspace now exists whatever the payment did; the session list
      // (the duplicate-name check and the Switcher both read it) must show
      // it at once, or a second create under a new name would go through.
      refreshWorkspaces({ details: false }).catch(() => undefined);
      if (payment.status === "started") {
        handedOff = true;
        handOffToStripe(workspace, payment);
        return;
      }
      if (payment.status === "settled") {
        // Paid without a checkout hop (the terms rule the path out; read
        // it as done): close rather than offer a payment that exists.
        handedOff = true;
        onOpenChange(false);
        return;
      }
      setStage({
        error: payment.error,
        kind: "payment-failed",
        plan,
        workspace,
      });
    } catch (cause) {
      if (cause instanceof WorkspaceNameConflictError) {
        // A 409 on a name this dialog just submitted can be Desktop having
        // created the Workspace while its answer never landed (a timeout,
        // a malformed envelope). Re-read the list: if the actor now owns
        // the name, offer the payment retry instead of "taken" — the user
        // already owns a Workspace they cannot pay for otherwise.
        await refreshWorkspaces({ details: false }).catch(() => undefined);
        const owned = store
          .get(workspacesAtom)
          .find(
            (candidate) =>
              candidate.role === "Owner" &&
              candidate.name.trim().toLowerCase() === trimmedName.toLowerCase()
          );
        if (owned != null) {
          setStage({
            error:
              "The Workspace was created, but its payment was never started.",
            kind: "payment-failed",
            plan,
            workspace: {
              id: owned.id,
              name: owned.name,
              uid: owned.uid,
            },
          });
          return;
        }
        setTakenNames((names) => [...names, trimmedName]);
        setNameIssue("duplicate");
        setStage({ kind: "pick" });
        return;
      }
      setError(errorDescription(cause, "The Workspace could not be created."));
    } finally {
      if (!handedOff) {
        setSubmitting(false);
      }
    }
  };

  const retry = async (plan: SnapshotPlan, workspace: CreatedWorkspace) => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    let handedOff = false;
    try {
      const payment = await services.retryPayment({
        appToken: credentials.appToken,
        kubeconfig: credentials.kubeconfig,
        planName: plan.name,
        regionDomain,
        workspaceId: workspace.id,
      });
      if (payment.status === "started") {
        handedOff = true;
        handOffToStripe(workspace, payment);
        return;
      }
      if (payment.status === "settled") {
        handedOff = true;
        onOpenChange(false);
        return;
      }
      setError(payment.error);
    } catch (cause) {
      setError(
        errorDescription(
          cause,
          "The subscription payment could not be started."
        )
      );
    } finally {
      if (!handedOff) {
        setSubmitting(false);
      }
    }
  };

  const closeStage = () => {
    if (submitting) {
      return;
    }
    // Leaving the failed-payment offer leaves the created Workspace as is
    // (spec §G.6): the whole dialog closes rather than returning to a
    // picker that would create a second one.
    if (stage.kind === "payment-failed") {
      onOpenChange(false);
      return;
    }
    setError(null);
    setStage({ kind: "pick" });
  };

  return (
    <AppDialog.Root
      onOpenChange={(nextOpen) => {
        if (!(nextOpen || submitting)) {
          onOpenChange(false);
        }
      }}
      open={open}
    >
      {/* Carries the Canvas Glow material like the plan-change dialog. */}
      <AppDialog.Content
        className="canvas-glow-overlay"
        data-slot="billing-workspace-creation-dialog"
        size="2xl"
      >
        <div className="flex shrink-0 items-center gap-4 px-8 pt-7">
          <AppDialog.Title className="h-auto font-semibold text-2xl/8">
            New Workspace
          </AppDialog.Title>
          <AppDialog.Description className="sr-only">
            Name the Workspace and choose its plan.
          </AppDialog.Description>
          <DialogClose
            aria-label="Close"
            className="-m-2 shrink-0 cursor-pointer rounded-md p-2 text-muted-foreground outline-none transition-colors hover:bg-input/30 hover:text-foreground focus-visible:ring-[1px] focus-visible:ring-blue-400/50"
          >
            <X aria-hidden className="size-5" />
          </DialogClose>
        </div>
        <AppDialog.Body className="gap-6 px-8 pt-6 pb-8">
          <AppInputField
            autoComplete="off"
            autoFocus
            className="max-w-md"
            description={`At most ${WORKSPACE_NAME_MAX_LENGTH} characters.`}
            error={
              nameIssue == null
                ? undefined
                : WORKSPACE_NAME_ISSUE_MESSAGES[nameIssue]
            }
            id={inputId}
            label="Workspace name"
            onChange={(event) => {
              setName(event.target.value);
              setNameIssue(null);
            }}
            ref={inputRef}
            value={name}
          />
          <BillingPlanPicker
            actionable
            currency={currency}
            gpuEnabled={gpuEnabled}
            inDebt={false}
            onOpenUrl={services.openUrl}
            onSelectPlan={selectPlan}
            pendingDowngradePlanName={null}
            plans={pickerPlans}
          />
        </AppDialog.Body>

        <AppDialog.Root
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              closeStage();
            }
          }}
          open={open && stage.kind !== "pick"}
        >
          <AppDialog.Content
            data-slot="billing-workspace-creation-confirm"
            overlayClassName={NESTED_DIALOG_OVERLAY}
          >
            {stage.kind === "confirm" ? (
              <ConfirmStage
                currency={currency}
                error={error}
                name={trimmedName}
                onConfirm={() => {
                  confirm(stage.plan).catch(() => undefined);
                }}
                plan={stage.plan}
                submitting={submitting}
              />
            ) : null}
            {stage.kind === "payment-failed" ? (
              <PaymentFailedStage
                error={error ?? stage.error}
                onRetry={() => {
                  retry(stage.plan, stage.workspace).catch(() => undefined);
                }}
                submitting={submitting}
                workspace={stage.workspace}
              />
            ) : null}
          </AppDialog.Content>
        </AppDialog.Root>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

function ConfirmStage({
  currency,
  error,
  name,
  onConfirm,
  plan,
  submitting,
}: {
  currency: BillingCurrency;
  error: string | null;
  name: string;
  onConfirm: () => void;
  plan: SnapshotPlan;
  submitting: boolean;
}) {
  return (
    <>
      <AppDialog.Header>
        <AppDialog.Title>Create Workspace</AppDialog.Title>
        <AppDialog.Description>
          The Workspace is created now; its plan starts once the payment
          completes.
        </AppDialog.Description>
      </AppDialog.Header>
      <AppDialog.Body>
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="min-w-0 truncate font-medium">{name}</dd>
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="font-medium">{plan.name}</dd>
          <dt className="text-muted-foreground">Price</dt>
          <dd className="font-medium tabular-nums">
            {formatBillingAmount(plan.priceMicroUnits, currency)}/month
          </dd>
        </dl>
        {error == null ? null : (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </AppDialog.Body>
      <AppDialog.Footer>
        <AppDialog.Cancel disabled={submitting} />
        <AppDialog.Action
          loading={submitting}
          loadingLabel="Creating…"
          onClick={onConfirm}
        >
          Create & Pay
        </AppDialog.Action>
      </AppDialog.Footer>
    </>
  );
}

function PaymentFailedStage({
  error,
  onRetry,
  submitting,
  workspace,
}: {
  error: string;
  onRetry: () => void;
  submitting: boolean;
  workspace: CreatedWorkspace;
}) {
  return (
    <>
      <AppDialog.Header>
        <AppDialog.Title>Workspace created</AppDialog.Title>
        <AppDialog.Description>
          “{workspace.name}” has been created, but its payment could not be
          started. Until it subscribes, it runs Pay-As-You-Go.
        </AppDialog.Description>
      </AppDialog.Header>
      <AppDialog.Body>
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      </AppDialog.Body>
      <AppDialog.Footer>
        {/* Closing this stage closes the whole dialog; see `closeStage`. */}
        <AppDialog.Cancel disabled={submitting}>Later</AppDialog.Cancel>
        <AppDialog.Action
          loading={submitting}
          loadingLabel="Starting payment…"
          onClick={onRetry}
        >
          Retry payment
        </AppDialog.Action>
      </AppDialog.Footer>
    </>
  );
}

export type { BillingWorkspaceCreationDialogProps };
