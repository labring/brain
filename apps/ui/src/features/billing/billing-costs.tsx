"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/vercel-tabs";
import { BarChart3, CalendarRange, ChevronRight, Layers3 } from "lucide-react";

function EmptyCostTable({ message }: { message: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Workspace</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell
            className="h-20 text-center text-muted-foreground"
            colSpan={3}
          >
            {message}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

export function BillingCostsSurface() {
  return (
    <Tabs className="flex flex-col gap-4" defaultValue="details">
      <TabsList aria-label="Cost views" className="w-fit">
        <TabsTrigger className="min-h-11" value="details">
          Cost details
        </TabsTrigger>
        <TabsTrigger className="min-h-11" value="trends">
          Cost and payment trends
        </TabsTrigger>
      </TabsList>

      <TabsContent value="details">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <div className="flex items-center justify-between border-border border-b px-5 py-3">
            <span className="font-medium text-foreground text-sm">
              Date range
            </span>
            <AppButton disabled variant="secondary">
              <CalendarRange aria-hidden data-icon="inline-start" />
              Last 30 days
            </AppButton>
          </div>

          <div className="grid min-h-96 lg:grid-cols-4">
            <aside className="border-border border-b p-4 lg:col-span-1 lg:border-r lg:border-b-0">
              <div className="mb-3 flex items-center gap-2">
                <Layers3
                  aria-hidden
                  className="size-4 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <h2 className="font-medium text-foreground text-sm">
                  Cost scope
                </h2>
              </div>
              <div className="flex min-h-10 w-full items-center justify-between rounded-lg bg-muted px-3 py-2 text-left font-medium text-foreground text-sm">
                All costs
                <ChevronRight aria-hidden className="size-4" />
              </div>
              <p className="mt-3 px-3 text-muted-foreground text-xs">
                Region and workspace filters will appear here.
              </p>
            </aside>

            <div className="min-w-0 lg:col-span-3">
              <div className="flex items-end justify-between border-border border-b px-5 py-4">
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-sm">
                    Total cost
                  </span>
                  <span className="font-semibold text-2xl text-foreground">
                    —
                  </span>
                </div>
              </div>

              <section aria-labelledby="subscription-costs-heading">
                <h2
                  className="border-border border-b px-5 py-3 font-medium text-foreground text-sm"
                  id="subscription-costs-heading"
                >
                  Subscription costs
                </h2>
                <EmptyCostTable message="Subscription cost data is not connected yet." />
              </section>

              <section
                aria-labelledby="metered-consumption-heading"
                className="border-border border-t"
              >
                <h2
                  className="border-border border-b px-5 py-3 font-medium text-foreground text-sm"
                  id="metered-consumption-heading"
                >
                  Metered consumption
                </h2>
                <EmptyCostTable message="Metered consumption data is not connected yet." />
              </section>
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="trends">
        <div className="rounded-xl border border-border bg-card shadow-xs">
          <Empty className="min-h-80">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BarChart3 aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Cost and payment trends</EmptyTitle>
              <EmptyDescription>
                Expenditure and payment history will appear here when the cost
                routes are connected.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </TabsContent>
    </Tabs>
  );
}
