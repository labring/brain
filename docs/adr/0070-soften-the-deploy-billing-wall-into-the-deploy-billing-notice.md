# Soften the Deploy Billing Wall into the Deploy Billing Notice

ADR-0068 placed one billing-standing judgment at three seams and made the pre-deploy seam a refusal: the Deploy Billing Wall replaced the deployment form whenever a Pay-As-You-Go workspace sat in Account Debt or any deployable quota was full. The judgment's formulas are the platform's own, but its inputs are not certainties: a mispinned Current Region silently renders subscribed workspaces as Pay-As-You-Go (ADR-0064), a standing read may predate a top-up or a freed quota, and a full storage or nodeport quota dooms only workloads that request those resources — yet the wall blocked every deployment, including an Edit & Redeploy that would shrink usage, and a first deployment had no misjudgment escape at all: Redeploy exists only on an existing task's timeline, and the assistant's deploy tool refused too. We decided the pre-deploy seam advises instead of refusing — the wall becomes the **Deploy Billing Notice** — and enforcement stays where it already lives: the platform's suspension and the terminal failure write's Billing Interruption judgment.

## Decision

**The notice informs; it never blocks.** The same judgment renders as a billing callout above the deployment form; the form stays usable and the deploy action stays enabled — no confirmation dialog, no "deploy anyway" wording, no disabled state. A user who presses through a correct notice spends one run that fails at the platform and comes back explained: the curated Deployment Failure Reason, its Billing Evidence, and Redeploy. That wasted run is the priced-in cost of never locking a misjudged workspace out of its first deployment.

**The notice speaks only of conditions that doom every deployment.** Three kinds: Account Debt on a Pay-As-You-Go workspace (top-up CTA), a full cpu, memory, or pod quota (plan-first CTA — Subscribe on Pay-As-You-Go, Upgrade plan otherwise, with View usage beside it; View usage alone at a confirmed plan ceiling), and — new, settling ADR-0068's deferred follow-up — a payment-due Workspace Subscription under the Deletion Countdown (renew CTA, the Status Hint's voice beside the form). A full storage or nodeport quota leaves the pre-form surface entirely: it dooms only workloads that request those resources, so it is told by form validation on the fields that ask for them — except in a pane whose every deployment requests the resource, where it dooms like the universal set and the notice speaks (the database pane's presets all carry storage).

**The judgment stays single.** Notice, Status Hint, and server standing keep sharing one predicate per condition, and the client and server debt predicates (`accountDebtHolds` / `debtSuspendsWorkspace`) merge into one function. The fail-open rule stands: an unreadable standing shows no notice, and a low but positive balance never does.

**The assistant's deploy tool keeps refusing.** Its refusal copy matches the notice and tells the user the pane will let them deploy regardless. A person may knowingly spend a doomed run; the assistant must not spend one silently on their behalf.

**The Paid Chat Wall is untouched.** A refused chat turn has no after-the-fact explanation scene — a spent turn is simply spent — so chat keeps its server-side 402 refusal. Deploy softens precisely because its failure is caught, named, and recoverable.

## Considered Options

- **Keep the refusal but narrow it (debt and cpu/memory/pod only) and add an escape link.** Rejected: the fragile part of the judgment is its inputs, not its formula — a stale read or a mispinned region walls a healthy workspace no matter how narrow the trigger, and a default-refusal wearing an escape link is a heavier surface than a notice for the same outcome.
- **A confirmation dialog on submit.** Rejected: it rebuilds the wall as a modal and doubles the friction for exactly the misjudged user the softening exists to free.
- **A "Deploy anyway" button label.** Rejected: under a misjudgment the button would apologize for a problem that does not exist; the notice carries the doubt, the button stays plain.
- **Soften the assistant's deploy tool in step.** Rejected: a tool that proceeds past its own warning spends the user's doomed run without the user's informed choice.

## Consequences

- The concept is renamed: CONTEXT.md's Deploy Billing Wall entry becomes Deploy Billing Notice, the Billing Interruption and Status Hint entries re-speak their cross-references, and Deployable Quota gains its own entry carrying the every-deployment (cpu/memory/pod) vs requested-only (storage/nodeport) split.
- This record leads the code. Follow-up implementation: render the callout above a usable form in the four deployment panes (which also un-blocks Edit & Redeploy), add the payment-due notice kind and give the reverse-check its Deployment Failure Reason so a pressed-through payment-due failure is named rather than left as the runner's stall, move storage/nodeport to field validation, and merge the debt predicates.
- `POST /api/deploy-tasks` never enforced the wall; under a notice, that asymmetry is the designed posture rather than a gap.
- Field validation exists where a field asks: the docker pane's storage rows. No pane field requests a nodeport today, so a full nodeport quota is voiced nowhere pre-deploy; the first field that exposes one owes that validation.- ADR-0068's judgment, terminal reverse-check, raw-display exception, and fail-open rule all stand; only its pre-deploy seam changes posture.
