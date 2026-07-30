import { AppButton } from "@workspace/ui/components/app-button";
import { Badge } from "@workspace/ui/components/badge";
import { Separator } from "@workspace/ui/components/separator";
import { TableCell, TableHead, TableRow } from "@workspace/ui/components/table";
import {
  TableLayout,
  TableLayoutBody,
  TableLayoutCaption,
  TableLayoutContent,
  TableLayoutHeadRow,
} from "@workspace/ui/components/table-layout";
import { CircleCheck, CreditCard, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

const PLAN_RESOURCE_LABELS = ["CPU quota", "Memory quota", "Storage quota"];

export function BillingPlanSurface({ balance }: { balance: ReactNode }) {
  return (
    <div className="flex flex-col gap-8 pb-16" data-slot="billing-plan-surface">
      <section
        className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs"
        data-slot="billing-plan-summary"
      >
        <div className="flex flex-col gap-5 bg-muted/30 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-sm">
                Current workspace plan
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-2xl text-foreground">
                  Plan details unavailable
                </h2>
                <Badge variant="outline">Not connected</Badge>
              </div>
            </div>
            <AppButton disabled size="lg">
              <Sparkles aria-hidden data-icon="inline-start" />
              Upgrade plan
            </AppButton>
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-3">
            {PLAN_RESOURCE_LABELS.map((label) => (
              <div className="flex items-center gap-2" key={label}>
                <CircleCheck
                  aria-hidden
                  className="size-4 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <span className="text-muted-foreground text-sm">
                  {label}: —
                </span>
              </div>
            ))}
          </div>
        </div>

        <dl className="grid gap-px border-border border-t bg-border sm:grid-cols-3">
          {["Price per month", "Quota resets on", "Expiration time"].map(
            (label) => (
              <div
                className="flex flex-col gap-2 bg-card px-6 py-5"
                key={label}
              >
                <dt className="text-muted-foreground text-sm">{label}</dt>
                <dd className="font-medium text-foreground">—</dd>
              </div>
            )
          )}
        </dl>
      </section>

      <section
        className="rounded-xl border border-border bg-card p-2 shadow-xs"
        data-slot="billing-balance-section"
      >
        <div className="flex min-h-24 items-center rounded-lg bg-muted/30 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-sm">
              Account Balance
            </span>
            {balance}
          </div>
        </div>
      </section>

      <section
        className="rounded-xl border border-border bg-card p-2 shadow-xs"
        data-slot="billing-payment-method-section"
      >
        <div className="flex min-h-20 flex-col gap-4 rounded-lg bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-input/40 text-muted-foreground">
              <CreditCard aria-hidden className="size-5" strokeWidth={1.75} />
            </div>
            <div className="flex flex-col gap-0.5">
              <h2 className="font-medium text-foreground text-sm">
                Payment method
              </h2>
              <p className="text-muted-foreground text-sm">
                Card details are not connected yet.
              </p>
            </div>
          </div>
          <AppButton disabled variant="secondary">
            Manage payment method
          </AppButton>
        </div>
      </section>

      <section data-slot="billing-all-plans-section">
        <h2 className="mb-4 font-medium text-foreground text-lg">All plans</h2>
        <TableLayout>
          <TableLayoutCaption className="font-medium">
            Workspaces
          </TableLayoutCaption>
          <TableLayoutContent>
            <TableLayoutHeadRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Quota resets on</TableHead>
              <TableHead>Price</TableHead>
            </TableLayoutHeadRow>
            <TableLayoutBody>
              <TableRow>
                <TableCell
                  className="h-24 text-center text-muted-foreground"
                  colSpan={4}
                >
                  Subscription list is not connected yet.
                </TableCell>
              </TableRow>
            </TableLayoutBody>
          </TableLayoutContent>
        </TableLayout>
      </section>
    </div>
  );
}
