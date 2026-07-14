import type {
  PendingSettingsClassification,
  PendingSettingsClassificationStatus,
} from "./pending-settings-updates";

export type PendingSettingsStatusAction = "edit" | "keep-target" | "use-latest";

export interface PendingSettingsStatusRow {
  actions: readonly PendingSettingsStatusAction[];
  body: string;
  domain: string;
  label: string;
  title: string;
}

export interface PendingSettingsStatusModel {
  rows: readonly PendingSettingsStatusRow[];
}

const PENDING_COPY: Record<
  Exclude<PendingSettingsClassificationStatus, "reconciled">,
  Pick<PendingSettingsStatusRow, "actions" | "body" | "title">
> = {
  "attention-needed": {
    actions: ["edit", "use-latest"],
    body: "This is taking longer than expected. You can keep editing from the target configuration or use the latest observed configuration.",
    title: "Still applying changes",
  },
  applying: {
    actions: [],
    body: "Your update was accepted. This page shows the target configuration while the resource catches up.",
    title: "Applying changes",
  },
  diverged: {
    actions: ["keep-target", "use-latest"],
    body: "The resource configuration changed after your update was accepted.",
    title: "Configuration changed elsewhere",
  },
};

const DOMAIN_LABELS: Record<string, string> = {
  "ap:environment": "Environment",
  "ap:launch": "Image & launch",
  "ap:network": "Network",
  "ap:resources": "Resources",
  "database:access": "Public connection",
  "database:resources": "Resources",
};

export function pendingSettingsDomainLabel({
  domain,
  kind,
}: {
  domain: string;
  kind: string;
}): string {
  return DOMAIN_LABELS[`${kind}:${domain}`] ?? domain;
}

export function buildPendingSettingsStatusModel(
  classifications: readonly PendingSettingsClassification[]
): PendingSettingsStatusModel {
  return {
    rows: classifications.flatMap((classification) => {
      if (classification.status === "reconciled") {
        return [];
      }
      const copy = PENDING_COPY[classification.status];
      return [
        {
          ...copy,
          domain: classification.entry.domain,
          label: pendingSettingsDomainLabel({
            domain: classification.entry.domain,
            kind: classification.entry.kind,
          }),
        },
      ];
    }),
  };
}
