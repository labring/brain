"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { DialogClose } from "@workspace/ui/components/dialog";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Eye, History, Info, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  formatSnapshotAge,
  formatSnapshotCount,
  imageVersionLabel,
} from "./container-history-format";
import type { ContainerHistorySnapshotRow } from "./container-history-pane.types";

export type { ContainerHistorySnapshotRow } from "./container-history-pane.types";

const HISTORY_VISIBLE_COUNT = 3;

function formatSnapshotTime(iso: string): string {
  const t = iso.trim();
  if (t === "") {
    return "—";
  }
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) {
    return t;
  }
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function versionReviewText(row: ContainerHistorySnapshotRow): string {
  return [
    `image: ${row.image.trim() === "" ? "-" : row.image}`,
    row.imagePullPolicy == null || row.imagePullPolicy === ""
      ? null
      : `imagePullPolicy: ${row.imagePullPolicy}`,
    `versionHash: ${row.versionHash}`,
    row.source == null || row.source === "" ? null : `source: ${row.source}`,
    `createdAt: ${row.createdAt}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function SnapshotHistoryListItem({
  onReviewConfig,
  onRollback,
  rollbackBusyVersionHash,
  row,
}: {
  onReviewConfig: (row: ContainerHistorySnapshotRow) => void;
  onRollback?: (versionHash: string) => void;
  rollbackBusyVersionHash: string | null;
  row: ContainerHistorySnapshotRow;
}) {
  const rollbackBusyAnywhere = rollbackBusyVersionHash !== null;
  const canRollback = onRollback != null && !rollbackBusyAnywhere;

  const rollbackInFlightHere = rollbackBusyVersionHash === row.versionHash;
  const title = imageVersionLabel(row);
  const age = formatSnapshotAge(row.createdAt);
  const image = row.image.trim() === "" ? "No image recorded" : row.image;

  return (
    <li>
      <article className="flex min-w-0 items-center gap-2 overflow-hidden rounded-lg bg-input/30 pr-2 shadow-sm">
        <div className="min-w-0 flex-1 px-4 py-4 text-left">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <h4
                className="truncate font-medium text-foreground text-sm leading-5"
                title={title}
              >
                {title}
              </h4>
              {age === "" ? null : (
                <p className="shrink-0 text-muted-foreground text-xs leading-4">
                  {age}
                </p>
              )}
            </div>
            <p
              className="truncate text-muted-foreground text-xs leading-4"
              title={image}
            >
              {image}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 py-3">
          <Tooltip>
            <TooltipTrigger
              render={
                <AppIconButton
                  aria-label={`Review image version ${title}`}
                  onClick={() => onReviewConfig(row)}
                  size="lg"
                  type="button"
                  variant="secondary"
                >
                  <Eye aria-hidden className="size-4" />
                </AppIconButton>
              }
            />
            <TooltipContent>Review settings</TooltipContent>
          </Tooltip>
          <AppButton
            aria-busy={rollbackInFlightHere}
            disabled={!canRollback || rollbackInFlightHere}
            onClick={() => onRollback?.(row.versionHash)}
            size="default"
            type="button"
            variant="secondary"
          >
            {rollbackInFlightHere ? (
              <>
                <Spinner aria-hidden className="size-4 text-muted-foreground" />
                Rolling back...
              </>
            ) : (
              <>
                <RotateCcw aria-hidden className="size-4" />
                Rollback
              </>
            )}
          </AppButton>
        </div>
      </article>
    </li>
  );
}

function ReviewVersionBody({
  yamlBody,
  yamlError,
  yamlLoading,
}: {
  yamlBody: string;
  yamlError: string | null;
  yamlLoading: boolean;
}) {
  /** Shared height avoids layout jump between loading spinner and scrolled version details. */
  const frame =
    "relative h-80 w-full overflow-hidden rounded-md border border-border bg-transparent";

  if (yamlLoading) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className={cn(frame, "flex flex-col items-center justify-center")}
      >
        <div className="flex flex-col items-center gap-3">
          <Spinner aria-hidden className="size-6 text-muted-foreground" />
          <span className="text-center text-muted-foreground text-sm">
            Loading version…
          </span>
        </div>
      </div>
    );
  }

  if (yamlError !== null) {
    return (
      <div className={cn(frame, "flex items-center px-4 py-4")}>
        <div
          className="w-full rounded-md border border-border border-destructive/40 bg-background px-4 py-3 text-destructive text-sm"
          role="alert"
        >
          {yamlError}
        </div>
      </div>
    );
  }

  if (yamlBody.trim() === "") {
    return (
      <div className={cn(frame, "flex items-center px-4 py-6")}>
        <p className="text-muted-foreground text-sm">
          No version details are available.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className={frame}>
      <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words px-3 py-2 font-sans text-foreground text-sm leading-5">
        {yamlBody.trim()}
      </pre>
    </ScrollArea>
  );
}

export interface ContainerHistoryPaneProps {
  className?: string;
  /** Loads detail text for a version, such as the captured image metadata. */
  onLoadConfigYaml?: (versionHash: string) => Promise<string>;
  /** Invoked after the user chooses Review — optional side channel (analytics, etc.). */
  onReview?: (versionHash: string) => void;
  /** Applies this image version through the AP product API. */
  onRollback?: (versionHash: string) => void;
  rollbackBusyVersionHash?: string | null;
  rows: ContainerHistorySnapshotRow[];
  /**
   * Registry / docs: show an explainer for how AP image versions are retained.
   * Omit in product UI where this is noise.
   */
  showSnapshotExplainerAlert?: boolean;
  workloadName: string;
}

export function ContainerHistoryPane({
  className,
  onLoadConfigYaml,
  onReview,
  onRollback,
  rollbackBusyVersionHash = null,
  rows,
  showSnapshotExplainerAlert = false,
  workloadName,
}: ContainerHistoryPaneProps) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRow, setReviewRow] =
    useState<ContainerHistorySnapshotRow | null>(null);
  const [yamlBody, setYamlBody] = useState("");
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [yamlLoading, setYamlLoading] = useState(false);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const hasVersionOverflow = rows.length > HISTORY_VISIBLE_COUNT;
  const visibleRows = showAllVersions
    ? rows
    : rows.slice(0, HISTORY_VISIBLE_COUNT);

  const handleReviewClose = useCallback((open: boolean) => {
    setReviewOpen(open);
    if (!open) {
      setReviewRow(null);
      setYamlBody("");
      setYamlError(null);
      setYamlLoading(false);
    }
  }, []);

  const handleReviewClick = useCallback(
    (row: ContainerHistorySnapshotRow) => {
      onReview?.(row.versionHash);
      const inline = versionReviewText(row).trim();
      const hasInline = inline !== "";
      setReviewRow(row);
      setYamlError(null);
      if (hasInline) {
        setYamlBody(inline);
        setYamlLoading(false);
      } else if (onLoadConfigYaml === undefined) {
        setYamlBody("");
        setYamlLoading(false);
      } else {
        setYamlBody("");
        setYamlLoading(true);
      }
      setReviewOpen(true);
    },
    [onLoadConfigYaml, onReview]
  );

  const reviewHashPreview = reviewRow === null ? "" : reviewRow.versionHash;

  useEffect(() => {
    if (rows.length <= HISTORY_VISIBLE_COUNT) {
      setShowAllVersions(false);
    }
  }, [rows.length]);

  useEffect(() => {
    if (!(reviewOpen && reviewRow !== null)) {
      return;
    }

    let cancelled = false;

    const inlineText = versionReviewText(reviewRow).trim();
    if (inlineText !== "") {
      setYamlBody(inlineText);
      setYamlError(null);
      setYamlLoading(false);
      return;
    }

    if (onLoadConfigYaml === undefined) {
      setYamlBody("");
      setYamlError(null);
      setYamlLoading(false);
      return;
    }

    setYamlLoading(true);
    onLoadConfigYaml(reviewRow.versionHash)
      .then((text) => {
        if (cancelled) {
          return;
        }
        const t = text.trim();
        if (t === "") {
          throw new Error("Empty version response.");
        }
        setYamlBody(t);
        setYamlError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setYamlBody("");
          setYamlError(
            e instanceof Error ? e.message : "Could not load version details."
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setYamlLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onLoadConfigYaml, reviewOpen, reviewRow]);

  return (
    <div
      className={cn("flex min-h-0 flex-col gap-3 overflow-hidden", className)}
    >
      {showSnapshotExplainerAlert ? (
        <Alert className="shrink-0 border-border">
          <Info className="text-muted-foreground" />
          <AlertTitle>AP image versions</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            The AP product API records image versions for{" "}
            <span className="font-mono text-foreground">{workloadName}</span> in
            the app database. This list shows retained versions for rollback.{" "}
            <span className="font-mono text-foreground">versionHash</span>{" "}
            identifies each image version.{" "}
            <span className="font-medium text-foreground">Active</span> is the
            current AP image. Retains the newest 10 versions per AP per
            namespace.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-border">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-border border-b px-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <History aria-hidden className="size-4 shrink-0 text-foreground" />
            <span className="truncate font-medium text-foreground text-sm leading-5">
              Version History
            </span>
          </div>
          <span className="shrink-0 text-muted-foreground text-sm leading-5">
            {formatSnapshotCount(rows.length)}
          </span>
        </div>
        <ScrollArea
          className={cn("min-h-0", showAllVersions && "max-h-[34rem]")}
        >
          <ul className="flex min-w-0 flex-col gap-2 p-2.5">
            {rows.length === 0 ? (
              <li className="rounded-lg bg-input/30 px-4 py-8 text-center text-muted-foreground text-sm leading-5">
                No image versions yet. They appear after AP image changes are
                applied.
              </li>
            ) : (
              visibleRows.map((row) => (
                <SnapshotHistoryListItem
                  key={row.versionHash}
                  onReviewConfig={handleReviewClick}
                  onRollback={onRollback}
                  rollbackBusyVersionHash={rollbackBusyVersionHash}
                  row={row}
                />
              ))
            )}
          </ul>
        </ScrollArea>
        {hasVersionOverflow ? (
          <button
            aria-expanded={showAllVersions}
            aria-label={
              showAllVersions
                ? "Show Less Image Versions"
                : "View All Image Versions"
            }
            className="mb-2 inline-flex h-5 shrink-0 cursor-pointer select-none items-center justify-center self-center whitespace-nowrap rounded-lg border border-transparent bg-transparent bg-clip-padding px-2 font-medium text-muted-foreground text-xs leading-5 outline-none transition-colors hover:bg-input/30 hover:text-foreground focus-visible:border-ring focus-visible:bg-input/30 focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={() => setShowAllVersions((current) => !current)}
            type="button"
          >
            {showAllVersions ? "Show Less" : "View All"}
          </button>
        ) : null}
      </div>

      <AppDialog.Root onOpenChange={handleReviewClose} open={reviewOpen}>
        <AppDialog.Content
          className="max-h-[calc(100vh-2rem)] data-[size=lg]:sm:max-w-[720px]"
          size="lg"
        >
          <AppDialog.Header className="flex h-[52px] items-center justify-between gap-2 px-4 py-0">
            <div className="flex min-w-0 items-center gap-2">
              <Eye aria-hidden className="size-4 shrink-0 text-blue-400" />
              <AppDialog.Title className="h-auto truncate text-lg leading-7">
                Image version
              </AppDialog.Title>
            </div>
            <DialogClose
              render={
                <AppIconButton
                  aria-label="Close image version"
                  className="size-9 shrink-0 text-zinc-300 hover:text-zinc-50"
                  size="lg"
                  type="button"
                  variant="quiet"
                >
                  <X aria-hidden className="size-4" />
                </AppIconButton>
              }
            />
          </AppDialog.Header>
          <AppDialog.Body className="mt-4 h-[min(444px,calc(100vh-7rem))] gap-4 overflow-y-auto overflow-x-hidden px-4 pt-0 pb-4">
            <AppDialog.Description className="text-muted-foreground text-sm leading-5">
              {reviewRow == null
                ? "Captured AP image version metadata."
                : `Image ${reviewRow.image.trim() === "" ? "-" : reviewRow.image}, saved ${formatSnapshotTime(reviewRow.createdAt)}.`}
            </AppDialog.Description>

            {reviewRow == null ? null : (
              <div className="flex flex-col gap-4 text-sm leading-5">
                <p className="break-all text-foreground">
                  {reviewRow.versionHash}
                </p>
                <p className="break-words text-muted-foreground">
                  Image:{" "}
                  <span className="text-foreground">
                    {reviewRow.image.trim() === "" ? "-" : reviewRow.image}
                  </span>
                  {" · "}
                  Saved:{" "}
                  <span className="text-foreground">
                    {formatSnapshotTime(reviewRow.createdAt)}
                  </span>
                  {reviewHashPreview === "" ? null : (
                    <>
                      {" · "}
                      Hash:{" "}
                      <span className="text-foreground">
                        {reviewHashPreview}
                      </span>
                    </>
                  )}
                </p>
              </div>
            )}

            <div className="min-h-0">
              <ReviewVersionBody
                yamlBody={yamlBody}
                yamlError={yamlError}
                yamlLoading={yamlLoading}
              />
            </div>
          </AppDialog.Body>
        </AppDialog.Content>
      </AppDialog.Root>
    </div>
  );
}

ContainerHistoryPane.displayName = "ContainerHistoryPane";
