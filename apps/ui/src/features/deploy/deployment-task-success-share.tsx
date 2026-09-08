"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { ComponentProps, ReactNode } from "react";

/**
 * Sharing the Deployment Task Success Record's primary HTTP(S) entry
 * (AIM-354): a QR code for a phone and one-click posts to four networks.
 *
 * What is shared is the product's own public address exactly as the record
 * snapshotted it — nothing of Brain, and no access model of its own
 * (CONTEXT.md, Deployment Task Success Record). The copy speaks in the
 * user's voice and names Sealos; it picks a voice from the facts the record
 * snapshotted (product id and categories), never from the live catalog.
 * This module is feature-local on purpose: it moves to `@workspace/ui` only
 * if a second consumer appears.
 */

/* ------------------------------------------------------------- pure copy */

/** The facts a share is built from, all read off the success record. */
export interface DeploymentTaskShareSubject {
  /** The product's snapshotted catalog categories, e.g. `game`, `ai`. */
  productCategories?: readonly string[];
  /** The product's catalog identity; the template name for a template deployment. */
  productId?: string;
  productName?: string;
  /** The primary HTTP(S) entry exactly as the record snapshotted it. */
  url: string;
}

const SEALOS_X_HANDLE = "@Sealos_io";
const EAGLERCRAFT_PRODUCT_ID = "eaglercraft-server";

/**
 * Which voice the X post speaks in. The one hard-coded product is
 * EaglerCraft (AIM-354: a deliberate product branch, superseding #336's
 * "no product branch"); after that only the first snapshotted category
 * counts, and anything else is the generic launch post.
 */
export type DeploymentTaskShareVoice =
  | "ai"
  | "eaglercraft"
  | "game"
  | "generic";

export function shareVoice(
  subject: Pick<DeploymentTaskShareSubject, "productCategories" | "productId">
): DeploymentTaskShareVoice {
  if (subject.productId?.trim().toLowerCase() === EAGLERCRAFT_PRODUCT_ID) {
    return "eaglercraft";
  }
  switch (subject.productCategories?.[0]?.trim().toLowerCase()) {
    case "ai":
      return "ai";
    case "game":
      return "game";
    default:
      return "generic";
  }
}

/**
 * The X post in three beats separated by blank lines — the announcement,
 * the link, the hashtags — so it scans the way posts on X usually do. The
 * product name is dropped, never invented.
 */
export function xPostText(subject: DeploymentTaskShareSubject): string {
  const name = subject.productName;
  const { announcement, link, tags } = ((): {
    announcement: [string, string];
    link: string;
    tags: string;
  } => {
    switch (shareVoice(subject)) {
      case "eaglercraft":
        return {
          announcement: [
            `My own Eaglercraft server is live! ${SEALOS_X_HANDLE}`,
            "Deployed with Sealos.",
          ],
          link: `Join here: ${subject.url}`,
          tags: "#Eaglercraft #Minecraft #Sealos",
        };
      case "game":
        return {
          announcement: [
            `My own game server is live! ${SEALOS_X_HANDLE}`,
            "Deployed with Sealos.",
          ],
          link: `Join here: ${subject.url}`,
          tags: "#Sealos",
        };
      case "ai":
        return {
          announcement: [
            name == null
              ? `I just took an idea to a live app with Sealos. ${SEALOS_X_HANDLE}`
              : `I just took ${name} from idea to live app with Sealos. ${SEALOS_X_HANDLE}`,
            "No complicated setup. Just deploy, share, and start building.",
          ],
          link: `Try it here: ${subject.url}`,
          tags: "#AI #BuildInPublic #Sealos",
        };
      default:
        return {
          announcement: [
            name == null
              ? `Just deployed with Sealos. ${SEALOS_X_HANDLE}`
              : `Just deployed ${name} with Sealos. ${SEALOS_X_HANDLE}`,
            "From idea to live app.",
          ],
          link: `Try it here: ${subject.url}`,
          tags: "#Sealos #BuildInPublic",
        };
    }
  })();
  return [...announcement, "", link, "", tags].join("\n");
}

/** The Reddit link-post title; the post's content is the address itself. */
export function redditTitle(productName: string | undefined): string {
  return productName == null
    ? "My app is live — just shipped with Sealos"
    : `${productName} is live — just shipped with Sealos`;
}

/** The host of `url`, or `url` itself when it cannot be parsed. */
export function shareHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/* --------------------------------------------------------------- channels */

function XIcon(props: ComponentProps<"svg">) {
  return (
    <svg aria-hidden fill="currentColor" viewBox="0 0 24 24" {...props}>
      <title>X</title>
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

function LinkedInIcon(props: ComponentProps<"svg">) {
  return (
    <svg aria-hidden fill="currentColor" viewBox="0 0 24 24" {...props}>
      <title>LinkedIn</title>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function FacebookIcon(props: ComponentProps<"svg">) {
  return (
    <svg aria-hidden fill="currentColor" viewBox="0 0 24 24" {...props}>
      <title>Facebook</title>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function RedditIcon(props: ComponentProps<"svg">) {
  return (
    <svg aria-hidden fill="currentColor" viewBox="0 0 24 24" {...props}>
      <title>Reddit</title>
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}

export interface DeploymentTaskSuccessShareChannel {
  /** The share URL for the subject; a pure function of the record's facts. */
  href: (subject: DeploymentTaskShareSubject) => string;
  Icon: (props: ComponentProps<"svg">) => ReactNode;
  id: "facebook" | "linkedin" | "reddit" | "x";
  /** The accessible name of the control, also its title. */
  label: string;
}

/** The fixed share channels, in the order the strip draws them. */
export const DEPLOYMENT_TASK_SUCCESS_SHARE_CHANNELS: readonly DeploymentTaskSuccessShareChannel[] =
  [
    {
      Icon: XIcon,
      href: (subject) =>
        `https://x.com/intent/post?text=${encodeURIComponent(xPostText(subject))}`,
      id: "x",
      label: "Post on X",
    },
    {
      Icon: LinkedInIcon,
      href: ({ url }) =>
        `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
      id: "linkedin",
      label: "Share on LinkedIn",
    },
    {
      Icon: FacebookIcon,
      href: ({ url }) =>
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      id: "facebook",
      label: "Share on Facebook",
    },
    {
      Icon: RedditIcon,
      href: ({ productName, url }) =>
        `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(redditTitle(productName))}`,
      id: "reddit",
      label: "Post on Reddit",
    },
  ];

/* ---------------------------------------------------------------- the QR */

/**
 * A QR on a white tile: scanners want dark-on-light whatever the theme. The
 * quiet zone is drawn by the code itself (`marginSize`) so the tile sits
 * flush inside its frame.
 */
function QrTile({ size, url }: { size: number; url: string }) {
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-md bg-white text-black">
      <QRCodeSVG
        bgColor="transparent"
        fgColor="currentColor"
        level="M"
        marginSize={2}
        size={size}
        value={url}
      />
    </span>
  );
}

/** The four viewfinder corners, each a bracket drawn from two borders. */
const SCAN_CORNERS = [
  "top-0 left-0 rounded-tl-sm border-t border-l",
  "top-0 right-0 rounded-tr-sm border-t border-r",
  "bottom-0 left-0 rounded-bl-sm border-b border-l",
  "right-0 bottom-0 rounded-br-sm border-r border-b",
] as const;

/** Viewfinder brackets around a QR: the four corners read as "scan me". */
function ScanFrame({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-flex p-2">
      {SCAN_CORNERS.map((corner) => (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute size-3 border-blue-400/70",
            corner
          )}
          key={corner}
        />
      ))}
      {children}
    </span>
  );
}

const QR_SIZE = 128;

/** The popover's body: the framed QR, what a scan opens, and the host it opens. */
export function DeploymentTaskSuccessQrPanel({ url }: { url: string }) {
  return (
    <>
      <ScanFrame>
        <QrTile size={QR_SIZE} url={url} />
      </ScanFrame>
      <div className="flex flex-col items-center gap-0.5">
        <span className="font-medium text-foreground text-xs leading-4">
          Open on your phone
        </span>
        <span
          className="max-w-60 truncate font-mono text-[11px] text-muted-foreground leading-4"
          title={url}
        >
          {shareHost(url)}
        </span>
      </div>
    </>
  );
}

function QrPopover({ url }: { url: string }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <AppIconButton
            aria-label="Show QR code"
            data-slot="deployment-task-success-share-qr"
            size="sm"
            title="Show QR code"
            type="button"
            variant="quiet"
          >
            <QrCode aria-hidden className="size-3.5" />
          </AppIconButton>
        }
      />
      <PopoverContent
        align="end"
        className="w-auto items-center gap-3 bg-popover/70 p-4 backdrop-blur-md"
        side="top"
      >
        <DeploymentTaskSuccessQrPanel url={url} />
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------- the strip */

/**
 * `Share <product>` on the left; on the right the QR trigger, then one icon
 * link per channel, all drawn as the quiet small app icon button so they
 * match the copy controls in the card. Every link opens in a new tab and
 * sends no referrer, so the Brain tab stays put and shares nothing of Brain.
 */
export function DeploymentTaskSuccessShareStrip({
  className,
  subject,
}: {
  className?: string;
  subject: DeploymentTaskShareSubject;
}) {
  const { productName, url } = subject;
  return (
    <div
      className={cn("flex items-center justify-between pl-2", className)}
      data-slot="deployment-task-success-share"
    >
      <span className="min-w-0 truncate text-[11px] text-muted-foreground leading-4">
        {productName == null ? "Share" : `Share ${productName}`}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <QrPopover url={url} />
        {DEPLOYMENT_TASK_SUCCESS_SHARE_CHANNELS.map(
          ({ Icon, href, id, label }) => (
            // The icon sits inside the anchor so the link carries its own
            // content; the wrapper's children slot stays empty on purpose.
            <AppIconButton
              aria-label={label}
              key={id}
              nativeButton={false}
              render={
                <a
                  href={href(subject)}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Icon className="size-3" />
                </a>
              }
              size="sm"
              title={label}
              variant="quiet"
            >
              {null}
            </AppIconButton>
          )
        )}
      </div>
    </div>
  );
}
