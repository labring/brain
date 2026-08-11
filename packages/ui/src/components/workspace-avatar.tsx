import { cn } from "@workspace/ui/lib/utils";
import Avatar from "boring-avatars";

/**
 * Palette and variant copied verbatim from the Sealos desktop team switcher
 * (WorkspaceToggle/NsListItem). The avatar is generated from the workspace id,
 * so keeping these identical is what makes the same workspace render the same
 * avatar in the desktop and here — do not swap these for theme tokens.
 */
const WORKSPACE_AVATAR_COLORS = [
  "#ff9e9e",
  "#b4f8cc",
  "#4294ff",
  "#ffe5f0",
  "#03e2db",
];

export interface WorkspaceAvatarProps {
  className?: string;
  /** The workspace's namespace id (`ns-…`), the generation seed. */
  workspaceId: string;
}

export function WorkspaceAvatar({
  className,
  workspaceId,
}: WorkspaceAvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 overflow-hidden rounded-full",
        className
      )}
      data-slot="workspace-avatar"
    >
      <Avatar
        colors={WORKSPACE_AVATAR_COLORS}
        name={workspaceId}
        size="100%"
        variant="marble"
      />
    </span>
  );
}
