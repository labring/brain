import { AppButton } from "@workspace/ui/components/app-button";
import { TableCell, TableHead, TableRow } from "@workspace/ui/components/table";
import {
  TableLayout,
  TableLayoutBody,
  TableLayoutCaption,
  TableLayoutContent,
  TableLayoutHeadRow,
} from "@workspace/ui/components/table-layout";
import { ChevronDown } from "lucide-react";

export function BillingUsageSurface() {
  return (
    <TableLayout data-slot="billing-usage-surface">
      <TableLayoutCaption>
        <h2 className="font-medium text-foreground">Workspace usage</h2>
        <AppButton disabled variant="secondary">
          Select workspace
          <ChevronDown aria-hidden data-icon="inline-end" />
        </AppButton>
      </TableLayoutCaption>

      <TableLayoutContent>
        <TableLayoutHeadRow>
          <TableHead className="w-1/5">Resource</TableHead>
          <TableHead className="w-1/5">Usage</TableHead>
          <TableHead className="w-1/5">Total</TableHead>
          <TableHead className="w-1/5">Used</TableHead>
          <TableHead className="w-1/5">Remaining</TableHead>
        </TableLayoutHeadRow>
        <TableLayoutBody>
          <TableRow>
            <TableCell
              className="h-28 text-center text-muted-foreground"
              colSpan={5}
            >
              Select a workspace to view CPU, memory, storage, and traffic quota
              usage.
            </TableCell>
          </TableRow>
        </TableLayoutBody>
      </TableLayoutContent>
    </TableLayout>
  );
}
