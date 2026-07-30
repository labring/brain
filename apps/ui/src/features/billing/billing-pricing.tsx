"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { TableCell, TableHead, TableRow } from "@workspace/ui/components/table";
import {
  TableLayout,
  TableLayoutBody,
  TableLayoutCaption,
  TableLayoutContent,
  TableLayoutHeadRow,
} from "@workspace/ui/components/table-layout";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/vercel-tabs";
import { Calculator, Layers3, TableProperties } from "lucide-react";

function PricingEmptyState({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: typeof Layers3;
  title: string;
}) {
  return (
    <Empty className="min-h-72">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function BillingPricingSurface() {
  return (
    <Tabs className="flex flex-col gap-4" defaultValue="plans">
      <TabsList aria-label="Pricing views">
        <TabsTrigger className="min-h-11" value="plans">
          Subscription plans
        </TabsTrigger>
        <TabsTrigger className="min-h-11" value="table">
          Price table
        </TabsTrigger>
        <TabsTrigger className="min-h-11" value="calculator">
          Price calculator
        </TabsTrigger>
      </TabsList>

      <TabsContent value="plans">
        <section
          className="overflow-hidden rounded-xl border border-border bg-card shadow-xs"
          data-slot="billing-plan-catalog"
        >
          <header className="border-border border-b bg-muted/30 px-5 py-3">
            <h2 className="font-medium text-foreground text-sm">
              Plan catalog
            </h2>
          </header>
          <PricingEmptyState
            description="Subscription plan options will appear here when the plan catalog route is connected."
            icon={Layers3}
            title="No plans available yet"
          />
        </section>
      </TabsContent>

      <TabsContent value="table">
        <TableLayout>
          <TableLayoutCaption>
            <h2 className="font-medium text-foreground">Metered prices</h2>
            <AppButton disabled variant="secondary">
              Billing cycle
            </AppButton>
          </TableLayoutCaption>
          <TableLayoutContent>
            <TableLayoutHeadRow>
              <TableHead>Resource</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Price</TableHead>
            </TableLayoutHeadRow>
            <TableLayoutBody>
              <TableRow>
                <TableCell colSpan={3}>
                  <PricingEmptyState
                    description="Metered prices will appear here for usage-based workspaces."
                    icon={TableProperties}
                    title="Price data is not connected"
                  />
                </TableCell>
              </TableRow>
            </TableLayoutBody>
          </TableLayoutContent>
        </TableLayout>
      </TabsContent>

      <TabsContent value="calculator">
        <section className="rounded-xl border border-border bg-card shadow-xs">
          <header className="border-border border-b bg-muted/30 px-5 py-3">
            <h2 className="font-medium text-foreground text-sm">
              Usage estimate
            </h2>
          </header>
          <PricingEmptyState
            description="The calculator will use the same metered price catalog after that route is connected."
            icon={Calculator}
            title="Price calculator is not connected"
          />
        </section>
      </TabsContent>
    </Tabs>
  );
}
