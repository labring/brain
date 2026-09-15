import { desktopOrigin } from "./workspace-switch-core";

/**
 * The Workspace Invite Link (spec §B.2, §F): Brain's route answers only the
 * code; the page appends it to Desktop's landing page,
 * `https://<Desktop origin>/WorkspaceInvite/?code=<code>`, the same link
 * Desktop's own Team Center hands out. The invitee accepts there; Brain
 * does nothing more and sees the new member on its next read.
 */

const INVITE_LANDING_PATH = "/WorkspaceInvite/";

/** How long Desktop keeps a code (its TTL index); the dialog's fixed note. */
export const INVITE_LINK_VALIDITY_NOTE = "The link is valid for 30 minutes.";

/** Null without a Desktop domain — nothing to build the link on. */
export function workspaceInviteUrl(input: {
  cloudDomain: string;
  code: string;
}): string | null {
  const origin = desktopOrigin(input.cloudDomain);
  const code = input.code.trim();
  if (origin == null || code === "") {
    return null;
  }
  return `${origin}${INVITE_LANDING_PATH}?code=${encodeURIComponent(code)}`;
}
