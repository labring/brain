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
  /**
   * Render the marble as a rounded square instead of a disc (the Workspace
   * Switcher's shape). The marble variant masks itself to a circle, so a
   * container radius alone cannot change the shape; seed and palette are
   * unchanged, so the same Workspace still renders the same marble.
   */
  square?: boolean;
  /** The workspace's namespace id (`ns-…`), the generation seed. */
  workspaceId: string;
}

export function WorkspaceAvatar({
  className,
  square = false,
  workspaceId,
}: WorkspaceAvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 overflow-hidden",
        square ? "rounded-md" : "rounded-full",
        className
      )}
      data-shape={square ? "square" : "round"}
      data-slot="workspace-avatar"
    >
      <Avatar
        colors={WORKSPACE_AVATAR_COLORS}
        name={workspaceId}
        size="100%"
        square={square}
        variant="marble"
      />
    </span>
  );
}
