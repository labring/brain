import {
  Table,
  TableBody,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";

function TableLayout({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-transparent text-card-foreground shadow-xs",
        className
      )}
      data-slot="table-layout"
      {...props}
    />
  );
}

function TableLayoutCaption({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-border border-b bg-white/5 px-4 py-3 text-sm",
        className
      )}
      data-slot="table-layout-caption"
      {...props}
    />
  );
}

interface TableLayoutHeadRowProps {
  children: React.ReactNode;
  className?: {
    thead?: string;
    tr?: string;
  };
}

function TableLayoutHeadRow({ children, className }: TableLayoutHeadRowProps) {
  return (
    <TableHeader className={cn("h-13", className?.thead)}>
      <TableRow className={cn("[&>th]:bg-transparent", className?.tr)}>
        {children}
      </TableRow>
    </TableHeader>
  );
}

function TableLayoutBody({
  className,
  ...props
}: React.ComponentProps<typeof TableBody>) {
  return (
    <TableBody
      className={cn("text-foreground", className)}
      data-slot="table-layout-body"
      {...props}
    />
  );
}

function TableLayoutFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("w-full border-border border-t text-sm", className)}
      data-slot="table-layout-footer"
      {...props}
    />
  );
}

function TableLayoutContent({
  className,
  ...props
}: React.ComponentProps<typeof Table>) {
  return (
    <Table
      className={cn("text-sm", className)}
      data-slot="table-layout-content"
      {...props}
    />
  );
}

export type { TableLayoutHeadRowProps };
export {
  TableLayout,
  TableLayoutBody,
  TableLayoutCaption,
  TableLayoutContent,
  TableLayoutFooter,
  TableLayoutHeadRow,
};
