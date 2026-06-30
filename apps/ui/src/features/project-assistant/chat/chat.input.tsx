"use client";

import { ProjectSourceDockerIcon } from "@workspace/ui/assets/project-source-icons";
import {
  AppIconButton,
  type AppIconButtonProps,
} from "@workspace/ui/components/app-icon-button";
import { buttonVariants } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { Database, Send, Square, Wrench } from "lucide-react";
import { type ComponentProps, useEffect, useLayoutEffect, useRef } from "react";
import { GithubDeployer } from "@/features/deployment/github-deployer/github-deployer";

import type { ChatGithubDeployPopoverConfig } from "./chat.types";

/** GitHub invertocat path (matches common monochrome mark). */
export const GITHUB_MARK_PATH =
  "M12 2c5.5228 0 10 4.47715 10 10 0 4.5716 -3.0686 8.4239 -7.2578 9.6162v-3.0117c0 -0.7275 -0.1595 -1.4465 -0.4678 -2.1055 2.1883 -0.7822 4.2783 -2.4447 4.2783 -4.4355 0 -1.2663 -0.4671 -2.75174 -1.5127 -3.63186V6l-2.9462 0.98828c-0.6589 -0.16036 -1.3628 -0.24706 -2.0938 -0.24707 -0.731 0 -1.4349 0.08673 -2.09375 0.24707L6.95996 6v2.43164c-1.04555 0.88009 -1.51163 2.36566 -1.51172 3.63186 0 1.9907 2.08913 3.6533 4.27735 4.4355 -0.26358 0.5635 -0.41862 1.1711 -0.45801 1.7901 -0.13854 0.0283 -0.25191 0.0415 -0.34473 0.04 -0.20756 -0.0033 -0.36606 -0.06 -0.51953 -0.1562 -1.11532 -0.7 -1.54401 -1.9835 -3.05566 -2.1543 -0.19076 -0.0214 -0.3474 0.1371 -0.34766 0.3291 0 0.1922 0.15921 0.3423 0.34473 0.3925 1.44216 0.39 1.42755 3.2266 3.54785 3.2598 0.11976 0.0019 0.24101 -0.0069 0.36426 -0.0186v1.6348C5.06807 20.4236 2 16.5713 2 12 2 6.47715 6.47715 2 12 2";

export type ChatGithubDeployButtonProps = Omit<
  AppIconButtonProps,
  "aria-label" | "children" | "onClick" | "size" | "type" | "variant"
> & {
  "aria-label"?: string;
  /** True while the host resolves GitHub credentials (e.g. cluster secret fetch). */
  authLoading?: boolean;
  /** True when a PAT/token is available to the host (do not pass the secret itself). */
  isAuthorized?: boolean;
  onComposerAction?: () => void;
};

export type ChatDatabaseDeployButtonProps = Omit<
  AppIconButtonProps,
  "aria-label" | "children" | "onClick" | "size" | "type" | "variant"
> & {
  "aria-label"?: string;
  onComposerAction?: () => void;
};

export type ChatDockerDeployButtonProps = Omit<
  AppIconButtonProps,
  "aria-label" | "children" | "onClick" | "size" | "type" | "variant"
> & {
  "aria-label"?: string;
  onComposerAction?: () => void;
};

export type ChatSkillsWorkflowButtonProps = Omit<
  AppIconButtonProps,
  "aria-label" | "children" | "onClick" | "size" | "type" | "variant"
> & {
  "aria-label"?: string;
  onComposerAction?: () => void;
};

/** Monochrome GitHub mark (same path as `GITHUB_MARK_PATH`). */
export function ChatGithubMark({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden
      className={cn("size-4 shrink-0 text-foreground", className)}
      height={16}
      viewBox="0 0 24 24"
      width={16}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>GitHub</title>
      <path d={GITHUB_MARK_PATH} fill="currentColor" />
    </svg>
  );
}

export type ChatGithubDeployPopoverProps = ChatGithubDeployPopoverConfig;

/** GitHub deployer in a popover; pass full config from the host. */
export function ChatGithubDeployPopover({
  actions = {},
  children,
  contentClassName,
  onOpenChange,
  open,
  states,
  triggerClassName,
}: ChatGithubDeployPopoverProps) {
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger
        aria-label="GitHub"
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon-lg" }),
          "shrink-0 rounded-xl",
          triggerClassName
        )}
        type="button"
      >
        <ChatGithubMark className="opacity-90" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-[min(100vw-2rem,22rem)]", contentClassName)}
        side="top"
      >
        <GithubDeployer.Root actions={actions} states={states}>
          {children ?? <GithubDeployer.Shell className="p-1" />}
        </GithubDeployer.Root>
      </PopoverContent>
    </Popover>
  );
}

/** Wrapper with `group` for sibling layouts (context strip + shell). Borders on shell/indicator react via `group-focus-within:border-border`. */
export function ChatComposerFocusScope({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("group flex w-full flex-col", className)}
      data-slot="chat-composer-focus-scope"
      {...props}
    />
  );
}

/** Bordered composer container; border color shows when this stack or any wrapping focus scope has focus-within. */
export function ChatComposerShell({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "group flex min-h-[130px] w-full flex-col justify-between gap-2 rounded-xl border border-transparent bg-input/30 p-[10px] backdrop-blur-sm focus-within:border-border group-focus-within:border-border",
        className
      )}
      data-slot="chat-composer-shell"
      {...props}
    />
  );
}

export type ChatComposerTextareaProps = Omit<
  ComponentProps<typeof Textarea>,
  "onChange" | "ref" | "rows" | "value"
> & {
  onPrimaryAction: () => void;
  onValueChange: (value: string) => void;
  responding?: boolean;
  value: string;
};

export function ChatComposerTextarea({
  className,
  placeholder = "Tell me your project ideas here...",
  onKeyDown,
  onPrimaryAction,
  onValueChange,
  responding = false,
  value,
  ...rest
}: ChatComposerTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const adjustHeight = () => {
      textarea.style.height = "auto";
      const minHeight = 20;
      const maxHeight = 80;
      const scrollHeight = textarea.scrollHeight;
      const nextHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
    };

    requestAnimationFrame(adjustHeight);
    textarea.addEventListener("input", adjustHeight);
    return () => {
      textarea.removeEventListener("input", adjustHeight);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: controlled `value` changes require a remeasure (e.g. clear after send).
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    const minHeight = 20;
    const maxHeight = 80;
    const scrollHeight = textarea.scrollHeight;
    const nextHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value]);

  return (
    <div className="w-full">
      <Textarea
        {...rest}
        className={cn(
          "max-h-20 min-h-5 w-full resize-none rounded-none border-0 bg-transparent! p-0 text-sm! leading-5 shadow-none focus-visible:border-0 not-aria-invalid:focus-visible:border-0 focus-visible:ring-0 not-aria-invalid:focus-visible:ring-0",
          className
        )}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !responding
          ) {
            e.preventDefault();
            onPrimaryAction();
          }
          onKeyDown?.(e);
        }}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        style={{ minHeight: 20 }}
        value={value}
      />
    </div>
  );
}

export function ChatComposerFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex h-9 items-center justify-between gap-1 text-sm",
        className
      )}
      {...props}
    />
  );
}

export type ChatComposerContextIndicatorProps = Omit<
  ComponentProps<"div">,
  "children"
> & {
  /** Labels shown as always-active toggles after the “Context:” prefix (empty strings omitted). */
  contextToggles?: readonly string[];
  /** Merged onto the bordered context chip row (below the outer overflow wrapper). */
  chipClassName?: string;
};

/** Context strip above footer; collapsed when the enclosing `group` has no focus-within, expands and slides into place when focused. */
export function ChatComposerContextIndicator({
  chipClassName,
  className,
  contextToggles,
  ...props
}: ChatComposerContextIndicatorProps) {
  const labels = (contextToggles ?? []).map((t) => t.trim()).filter(Boolean);
  if (labels.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "min-w-0 shrink-0 overflow-hidden",
        // Exit animation: add delay when grid contracts (focus lost)
        "group-not-focus-within:delay-70",
        className
      )}
      data-slot="chat-composer-context-indicator"
      {...props}
    >
      <div className="flex min-h-0 items-center justify-center">
        <div
          className={cn(
            "flex h-12 min-h-8 w-[98%] min-w-0 translate-y-full gap-1 overflow-hidden rounded-xl border border-transparent bg-input/30 p-1 px-2 text-muted-foreground text-xs opacity-0 shadow-sm",

            // Base transition (applies to both enter + exit)
            "transition-all duration-300 ease-out motion-reduce:transition-none",

            // Enter state
            "group-focus-within:translate-y-6 group-focus-within:border-border group-focus-within:opacity-100",

            // Optional: slight delay on exit for polish
            "group-focus-within:delay-75",
            chipClassName
          )}
        >
          <span className="shrink-0 text-muted-foreground">Context:</span>
          <div className="min-w-0 flex-1 flex-wrap items-center">
            {labels.map((label, index) => (
              <span
                className="pointer-events-none shrink-0 text-foreground text-xs"
                key={`${label}:${String(index)}`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Icon-only control for GitHub deploy; omitted `onComposerAction` renders nothing. */
export function ChatGithubDeployButton({
  className,
  "aria-label": ariaLabel = "GitHub deploy",
  authLoading = false,
  isAuthorized: isAuthorizedProp,
  onComposerAction,
  ...props
}: ChatGithubDeployButtonProps) {
  if (!onComposerAction) {
    return null;
  }

  const isAuthorized = isAuthorizedProp ?? false;

  let title: string;
  if (authLoading) {
    title = "Loading GitHub credential…";
  } else if (isAuthorized) {
    title = "GitHub import";
  } else {
    title = "GitHub import — open to connect or configure secrets";
  }

  return (
    <AppIconButton
      aria-busy={authLoading}
      aria-label={ariaLabel}
      className={cn("shrink-0 cursor-pointer", className)}
      data-github-authorized={isAuthorized || undefined}
      data-slot="chat-github-deploy-button"
      onClick={onComposerAction}
      size="lg"
      title={title}
      type="button"
      variant="quiet"
      {...props}
    >
      <ChatGithubMark />
    </AppIconButton>
  );
}

/** Icon-only control for database deploy; omitted `onComposerAction` renders nothing. */
export function ChatDatabaseDeployButton({
  className,
  "aria-label": ariaLabel = "Database deploy",
  onComposerAction,
  ...props
}: ChatDatabaseDeployButtonProps) {
  if (!onComposerAction) {
    return null;
  }

  return (
    <AppIconButton
      aria-label={ariaLabel}
      className={cn("shrink-0 cursor-pointer", className)}
      data-slot="chat-database-deploy-button"
      onClick={onComposerAction}
      size="lg"
      title="Database deploy"
      type="button"
      variant="quiet"
      {...props}
    >
      <Database aria-hidden className="size-4 text-foreground opacity-90" />
    </AppIconButton>
  );
}

/** Icon-only control for Docker deploy; omitted `onComposerAction` renders nothing. */
export function ChatDockerDeployButton({
  className,
  "aria-label": ariaLabel = "Docker deploy",
  onComposerAction,
  ...props
}: ChatDockerDeployButtonProps) {
  if (!onComposerAction) {
    return null;
  }

  return (
    <AppIconButton
      aria-label={ariaLabel}
      className={cn("shrink-0 cursor-pointer", className)}
      data-slot="chat-docker-deploy-button"
      onClick={onComposerAction}
      size="lg"
      title="Docker deploy"
      type="button"
      variant="quiet"
      {...props}
    >
      <ProjectSourceDockerIcon
        aria-hidden
        className="size-4 text-foreground opacity-90"
      />
    </AppIconButton>
  );
}

/** Icon-only control for Sealos Skills workflow; omitted `onComposerAction` renders nothing. */
export function ChatSkillsWorkflowButton({
  className,
  "aria-label": ariaLabel = "Sealos Skills workflow",
  onComposerAction,
  ...props
}: ChatSkillsWorkflowButtonProps) {
  if (!onComposerAction) {
    return null;
  }

  return (
    <AppIconButton
      aria-label={ariaLabel}
      className={cn("shrink-0 cursor-pointer", className)}
      data-slot="chat-skills-workflow-button"
      onClick={onComposerAction}
      size="lg"
      title="Sealos Skills workflow"
      type="button"
      variant="quiet"
      {...props}
    >
      <Wrench aria-hidden className="size-4 text-foreground opacity-90" />
    </AppIconButton>
  );
}

export interface ChatComposerSendProps {
  className?: string;
  onPrimaryAction: () => void;
  responding?: boolean;
  value: string;
}

export function ChatComposerSend({
  className,
  onPrimaryAction,
  responding = false,
  value,
}: ChatComposerSendProps) {
  const sendDisabled = !(responding || value.trim());

  return (
    <AppIconButton
      aria-label={responding ? "Stop response" : "Send message"}
      className={cn(
        "shrink-0 transition-all duration-100",
        sendDisabled ? "cursor-not-allowed" : "cursor-pointer",
        className
      )}
      disabled={sendDisabled}
      onClick={onPrimaryAction}
      size="lg"
      type="button"
      variant="primary"
    >
      {responding ? <Square className="size-4" /> : <Send className="size-4" />}
    </AppIconButton>
  );
}

export type ChatComposerProps = ComponentProps<typeof ChatComposerShell> & {
  /** Shown as always-on chips in {@link ChatComposerContextIndicator}. */
  contextToggles?: readonly string[];
  onComposerAction?: () => void;
  onPrimaryAction: () => void;
  onValueChange: (value: string) => void;
  placeholder?: string;
  responding?: boolean;
  value: string;
};

/** Shell + textarea + optional context row + footer row (default composer). */
export function ChatComposer({
  className,
  contextToggles,
  onComposerAction,
  onPrimaryAction,
  onValueChange,
  placeholder = "Tell me your project ideas here...",
  responding = false,
  value,
  ...shellProps
}: ChatComposerProps) {
  return (
    <ChatComposerShell className={className} {...shellProps}>
      <div className="flex min-h-0 w-full flex-col gap-2">
        <div className="flex min-h-0 w-full flex-col">
          <ChatComposerTextarea
            onPrimaryAction={onPrimaryAction}
            onValueChange={onValueChange}
            placeholder={placeholder}
            responding={responding}
            value={value}
          />
          <ChatComposerContextIndicator contextToggles={contextToggles} />
        </div>
        <ChatComposerFooter>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <ChatGithubDeployButton onComposerAction={onComposerAction} />
            <ChatDockerDeployButton onComposerAction={onComposerAction} />
            <ChatDatabaseDeployButton onComposerAction={onComposerAction} />
            <ChatSkillsWorkflowButton onComposerAction={onComposerAction} />
          </div>
          <ChatComposerSend
            onPrimaryAction={onPrimaryAction}
            responding={responding}
            value={value}
          />
        </ChatComposerFooter>
      </div>
    </ChatComposerShell>
  );
}

ChatComposerFocusScope.displayName = "Chat.ComposerFocusScope";
ChatComposerShell.displayName = "Chat.ComposerShell";
ChatComposerTextarea.displayName = "Chat.ComposerTextarea";
ChatComposerFooter.displayName = "Chat.ComposerFooter";
ChatComposerContextIndicator.displayName = "Chat.ContextIndicator";
ChatComposerSend.displayName = "Chat.ComposerSend";
ChatGithubMark.displayName = "Chat.GithubMark";
ChatGithubDeployPopover.displayName = "Chat.GithubDeployPopover";
ChatDatabaseDeployButton.displayName = "Chat.DatabaseDeployButton";
ChatDockerDeployButton.displayName = "Chat.DockerDeployButton";
ChatGithubDeployButton.displayName = "Chat.GithubDeployButton";
ChatSkillsWorkflowButton.displayName = "Chat.SkillsWorkflowButton";
ChatComposer.displayName = "Chat.Composer";
