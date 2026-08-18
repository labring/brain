"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { ResourceSettingsSection } from "@workspace/ui/components/resource-settings/resource-settings";
import { Spinner } from "@workspace/ui/components/spinner";
import { CircleAlert, Package } from "lucide-react";

import type { ApImageUpdateStatus } from "./use-ap-image-update";

export interface ImageUpdateSectionProps {
  busy: boolean;
  dirty: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onKeepTarget: () => void;
  onSubmit: () => void;
  onUseLatest: () => void;
  status: ApImageUpdateStatus;
  value: string;
}

/**
 * Inline AP image editor for the Image Versions surface. The Update button
 * submits immediately (this is a Resource Surface, not a Settings View), but
 * the update itself travels the settings lifecycle — see ADR-0062.
 */
export function ImageUpdateSection({
  busy,
  dirty,
  disabled,
  onChange,
  onKeepTarget,
  onSubmit,
  onUseLatest,
  status,
  value,
}: ImageUpdateSectionProps) {
  const diverged = status?.kind === "diverged";
  const editingDisabled = disabled || diverged;
  const canSubmit = dirty && !(busy || editingDisabled);
  const shownImage = value.trim() === "" ? "No image configured" : value;

  return (
    <ResourceSettingsSection icon={Package} title="Image">
      <form
        className="flex min-w-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            onSubmit();
          }
        }}
      >
        <AppInput
          aria-label="AP image"
          className="min-w-0 flex-1"
          disabled={editingDisabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="ghcr.io/org/app:1.0.0"
          title={shownImage}
          value={value}
        />
        <AppButton
          aria-label="Update AP image"
          disabled={!canSubmit}
          type="submit"
          variant="secondary"
        >
          {busy ? (
            <Spinner aria-hidden className="size-4 text-muted-foreground" />
          ) : null}
          Update
        </AppButton>
      </form>
      {diverged ? (
        <Alert className="border-border">
          <CircleAlert aria-hidden className="text-muted-foreground" />
          <AlertTitle>Configuration changed elsewhere</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            <p>
              The AP image is now{" "}
              <span className="break-all font-mono text-foreground">
                {status.observedImage}
              </span>
              , not your submitted{" "}
              <span className="break-all font-mono text-foreground">
                {status.targetImage}
              </span>
              .
            </p>
            <div className="flex items-center gap-2">
              <AppButton
                disabled={busy}
                onClick={onKeepTarget}
                size="sm"
                type="button"
                variant="secondary"
              >
                Keep my target
              </AppButton>
              <AppButton
                disabled={busy}
                onClick={onUseLatest}
                size="sm"
                type="button"
                variant="quiet"
              >
                Use latest
              </AppButton>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
    </ResourceSettingsSection>
  );
}
