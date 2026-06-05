"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps } from "react";
import { ChatRoot } from "./chat.context";
import {
  ChatHeader,
  ChatHeaderClosePane,
  ChatHeaderNewThread,
  ChatHeaderSetting,
  ChatThreadSelect,
} from "./chat.header";
import {
  ChatComposer,
  ChatComposerContextIndicator,
  ChatComposerFocusScope,
  ChatComposerFooter,
  ChatComposerSend,
  ChatComposerShell,
  ChatComposerTextarea,
  ChatDatabaseDeployButton,
  ChatDockerDeployButton,
  ChatGithubDeployButton,
  ChatGithubDeployPopover,
  ChatGithubMark,
} from "./chat.input";
import { ChatTranscript } from "./chat.transcript";

// biome-ignore lint/performance/noBarrelFile: compound API re-exports
export { ChatRoot } from "./chat.context";
export type {
  ChatHeaderClosePaneProps,
  ChatHeaderNewThreadProps,
  ChatHeaderProps,
  ChatHeaderSettingProps,
  ChatThreadSelectProps,
} from "./chat.header";
export type {
  ChatComposerContextIndicatorProps,
  ChatComposerProps,
  ChatComposerSendProps,
  ChatComposerTextareaProps,
  ChatDatabaseDeployButtonProps,
  ChatDockerDeployButtonProps,
  ChatGithubDeployButtonProps,
  ChatGithubDeployPopoverProps,
} from "./chat.input";
export {
  ChatComposerContextIndicator,
  ChatComposerFocusScope,
  ChatDatabaseDeployButton,
  ChatDockerDeployButton,
  ChatGithubDeployButton,
  ChatGithubDeployPopover,
  ChatGithubMark,
  GITHUB_MARK_PATH,
} from "./chat.input";
export type {
  ChatGithubDeployPopoverConfig,
  ChatHeaderThreadHistory,
  ChatHeaderThreadHistoryItem,
  ChatMessagesStates,
  ChatRootProps,
  ChatTranscriptProps,
  UIMessage,
} from "./chat.types";

function ChatShell({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "project-chrome-surface flex min-h-0 w-full flex-1 flex-col",
        className
      )}
      data-slot="chat"
      {...props}
    >
      {children}
    </div>
  );
}

export const Chat = Object.assign(ChatShell, {
  ClosePane: ChatHeaderClosePane,
  Composer: ChatComposer,
  ComposerFocusScope: ChatComposerFocusScope,
  ComposerFooter: ChatComposerFooter,
  ComposerSend: ChatComposerSend,
  ComposerShell: ChatComposerShell,
  ComposerTextarea: ChatComposerTextarea,
  ContextIndicator: ChatComposerContextIndicator,
  DatabaseDeployButton: ChatDatabaseDeployButton,
  DockerDeployButton: ChatDockerDeployButton,
  GithubDeployButton: ChatGithubDeployButton,
  GithubDeployPopover: ChatGithubDeployPopover,
  GithubMark: ChatGithubMark,
  Header: ChatHeader,
  NewThread: ChatHeaderNewThread,
  Root: ChatRoot,
  Setting: ChatHeaderSetting,
  ThreadSelect: ChatThreadSelect,
  Transcript: ChatTranscript,
});

ChatShell.displayName = "Chat";
