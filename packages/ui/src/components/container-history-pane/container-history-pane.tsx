"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { Badge } from "@workspace/ui/components/badge";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { History, Info } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { ContainerHistorySnapshotRow } from "./container-history-pane.types";

export type { ContainerHistorySnapshotRow } from "./container-history-pane.types";

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
  const canRollback =
    row.variant === "orphan" && onRollback != null && !rollbackBusyAnywhere;

  const rollbackInFlightHere = rollbackBusyVersionHash === row.versionHash;

  return (
    <li className="py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-foreground text-xs">
              {row.versionHash}
            </span>
            {row.variant === "active" ? (
              <Badge variant="default">Active</Badge>
            ) : null}
            {row.source == null || row.source === "" ? null : (
              <Badge variant="secondary">{row.source}</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
            <span>
              Image:{" "}
              <span className="text-foreground">
                {row.image.trim() === "" ? "-" : row.image}
              </span>
            </span>
            {row.imagePullPolicy == null ||
            row.imagePullPolicy === "" ? null : (
              <span>
                Pull:{" "}
                <span className="text-foreground">{row.imagePullPolicy}</span>
              </span>
            )}
            <span>
              Saved:{" "}
              <span className="text-foreground">
                {formatSnapshotTime(row.createdAt)}
              </span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <AppButton
            onClick={() => onReviewConfig(row)}
            size="sm"
            type="button"
            variant="quiet"
          >
            Review config
          </AppButton>
          {row.variant === "orphan" ? (
            <AppButton
              aria-busy={rollbackInFlightHere}
              disabled={!canRollback || rollbackInFlightHere}
              onClick={() => onRollback?.(row.versionHash)}
              size="sm"
              type="button"
              variant="secondary"
            >
              {rollbackInFlightHere ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner
                    aria-hidden
                    className="size-4 text-muted-foreground"
                  />
                  Rolling back…
                </span>
              ) : (
                "Rollback"
              )}
            </AppButton>
          ) : null}
        </div>
      </div>
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
  /** Shared height avoids layout jump between loading spinner and scrolled YAML */
  const frame =
    "relative h-[min(22rem,48vh)] w-full overflow-hidden rounded-lg border border-border bg-muted/10";

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
      <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-foreground text-xs leading-relaxed">
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
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden",
        className
      )}
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
        <div className="flex shrink-0 items-center gap-2 border-border border-b bg-muted/30 px-3 py-2">
          <History aria-hidden className="size-4 text-muted-foreground" />
          <span className="font-medium text-foreground text-sm">
            Image versions
          </span>
          <Badge className="ml-auto" variant="secondary">
            {rows.length}
          </Badge>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="divide-y divide-border px-3">
            {rows.length === 0 ? (
              <li className="py-8 text-center text-muted-foreground text-sm">
                No image versions yet. They appear after AP image changes are
                applied.
              </li>
            ) : (
              rows.map((row) => (
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
      </div>

      <AppDialog.Root onOpenChange={handleReviewClose} open={reviewOpen}>
        <AppDialog.Content size="lg">
          <AppDialog.Header>
            <AppDialog.Title>Image version</AppDialog.Title>
          </AppDialog.Header>
          <AppDialog.Body>
            <AppDialog.Description>
              {reviewRow == null
                ? "Captured AP image version metadata."
                : `Image ${reviewRow.image.trim() === "" ? "-" : reviewRow.image}, saved ${formatSnapshotTime(reviewRow.createdAt)}.`}
            </AppDialog.Description>

            {reviewRow == null ? null : (
              <div className="flex flex-col gap-1 text-sm text-zinc-400">
                <p className="break-all font-mono text-xs text-zinc-100 leading-relaxed">
                  {reviewRow.versionHash}
                </p>
                <p>
                  Image:{" "}
                  <span className="text-zinc-100">
                    {reviewRow.image.trim() === "" ? "-" : reviewRow.image}
                  </span>
                  {" · "}
                  Saved:{" "}
                  <span className="text-zinc-100">
                    {formatSnapshotTime(reviewRow.createdAt)}
                  </span>
                  {reviewHashPreview === "" ? null : (
                    <>
                      {" · "}
                      Hash:{" "}
                      <span className="font-mono text-zinc-100">
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

          <AppDialog.Footer>
            <AppDialog.Cancel>Close</AppDialog.Cancel>
          </AppDialog.Footer>
        </AppDialog.Content>
      </AppDialog.Root>
    </div>
  );
}

ContainerHistoryPane.displayName = "ContainerHistoryPane";
