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
      "inline-flex items-center gap-1 rounded-md border border-border bg-input/40 px-1.5 py-0.5 text-foreground text-xs backdrop-blur-sm",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type TaskItemProps = ComponentProps<"div">;

export const TaskItem = ({ children, className, ...props }: TaskItemProps) => (
  <div className={cn("text-muted-foreground text-sm", className)} {...props}>
    {children}
  </div>
);

export type TaskProps = ComponentProps<typeof Collapsible>;

export const Task = ({ defaultOpen, className, open, ...props }: TaskProps) => {
  const resolvedDefault = defaultOpen ?? true;
  return (
    <Collapsible
      className={cn(className)}
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
      "group flex w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-1 py-1 text-left text-muted-foreground text-sm transition-colors hover:border-border hover:bg-input/30 hover:text-foreground",
      className
    )}
    type="button"
    {...props}
  >
    {children ?? (
      <>
        <ListTodo className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 truncate font-medium">{title}</p>
        <ChevronDown className="size-4 shrink-0 transition-transform group-data-panel-open:rotate-180" />
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
  <CollapsibleContent className={cn("mt-2 outline-none", className)} {...props}>
    <div className="space-y-2 border-border border-l pl-3">{children}</div>
  </CollapsibleContent>
);
