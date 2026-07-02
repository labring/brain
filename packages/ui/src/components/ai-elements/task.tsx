"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronDown, ListTodo } from "lucide-react";
import type { ComponentProps } from "react";

export type TaskItemFileProps = ComponentProps<"div">;

export const TaskItemFile = ({
  children,
  className,
  ...props
}: TaskItemFileProps) => (
  <div
    className={cn(
      "inline-flex items-center gap-1 rounded-md border border-border/70 bg-input/30 px-1.5 py-0.5 font-medium text-foreground/85 text-xs backdrop-blur-sm",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type TaskItemProps = ComponentProps<"div">;

export const TaskItem = ({ children, className, ...props }: TaskItemProps) => (
  <div
    className={cn("text-muted-foreground text-sm leading-6", className)}
    {...props}
  >
    {children}
  </div>
);

export type TaskProps = ComponentProps<typeof Collapsible>;

export const Task = ({ defaultOpen, className, open, ...props }: TaskProps) => {
  const resolvedDefault = defaultOpen ?? true;
  return (
    <Collapsible
      className={cn(
        "w-full min-w-0 rounded-lg border border-border/45 bg-input/10 p-1",
        className
      )}
      {...(open === undefined
        ? { defaultOpen: resolvedDefault }
        : { open, defaultOpen: undefined })}
      {...props}
    />
  );
};

export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
};

export const TaskTrigger = ({
  children,
  className,
  title,
  ...props
}: TaskTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted-foreground text-sm transition-colors hover:bg-input/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
      className
    )}
    type="button"
    {...props}
  >
    {children ?? (
      <>
        <ListTodo className="size-3.5 shrink-0 text-muted-foreground/80" />
        <p className="min-w-0 flex-1 truncate font-medium">{title}</p>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
      </>
    )}
  </CollapsibleTrigger>
);

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export const TaskContent = ({
  children,
  className,
  ...props
}: TaskContentProps) => (
  <CollapsibleContent className={cn("mt-1 outline-none", className)} {...props}>
    <div className="space-y-1.5 border-border/60 border-l py-0.5 pl-4">
      {children}
    </div>
  </CollapsibleContent>
);
