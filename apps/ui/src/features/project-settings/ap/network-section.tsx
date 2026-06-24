"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInputField } from "@workspace/ui/components/app-input-field";
import { CanvasNode } from "@workspace/ui/components/canvas-node/canvas-node";
import { Label } from "@workspace/ui/components/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Network, Plus, Settings, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { SettingsLeaveGuardHandle } from "../settings-leave-guard";
import {
  type ApNetworkDraftController,
  useApNetworkDraftController,
} from "./ap-network-draft";
import {
  type ApCustomDomainCnameVerificationResult,
  type ApCustomDomainCnameVerifier,
  type ApNetwork,
  type ApNetworkAppListeningPort,
  type ApNetworkCustomDomain,
  type ApNetworkCustomDomainDetail,
  type ApNetworkPlatformAddressDraftContext,
  type ApNetworkPublicAddress,
  type ApNetworkPublicAddressDraft,
  type ApNetworkVisibleDomainRows,
  type ApNetworkVisiblePublicAddressRow,
  addedAppListeningPorts,
  apNetworksEqual,
  appListeningPortsFromNetwork,
  publicAddressDefaultPort,
  publicAddressDisplayName,
  publicAddressesTargetingPort,
  publicAddressIdValue,
  visibleDomainRows,
} from "./ap-network-model";
import { apNetworkDraftBackingKey } from "./ap-settings-draft";
import type {
  ApPublicAddressesSettingsSectionsProps,
  ApSettingsSectionsModel,
} from "./ap-settings-model";
import {
  generateCustomDomainBindingId,
  generatePlatformAddressDomainPrefix,
  generatePlatformAddressId,
  platformAddressEndpoint,
} from "./lib/platform-address";
import { parsePortNumberDigits } from "./lib/port-number";
import {
  applySettingsDraftBackingResult,
  commitSettingsDraftBackingState,
  createSettingsDraftBackingState,
  failSettingsDraftSave,
  keepEditingSettingsDraftBackingState,
  prepareSettingsDraftSubmit,
  reloadSettingsDraftBackingState,
  syncSettingsDraftBackingState,
} from "./lib/settings-draft-backing";
import { ApSettingsDraftFooter } from "./workload-sections";

interface NetworkSettingsSectionProps {
  controller: ApNetworkDraftController;
  onCustomDomainCnameVerify?: ApCustomDomainCnameVerifier;
  platformAddressDraftContext?: ApNetworkPlatformAddressDraftContext;
  readOnly: boolean;
}

const PUBLIC_ADDRESS_VISIBLE_COUNT = 3;
const PUBLIC_ADDRESS_DRAFT_DOMAINS = ["network"] as const;
const PUBLIC_ADDRESS_SUBMIT_CONFLICT_MESSAGE =
  "Public Address configuration changed since you started editing.";

function publicAddressValue(address: ApNetworkPublicAddress): string {
  return address.url?.trim() || address.host?.trim() || "";
}

function publicAddressHostValue(
  address: ApNetworkPublicAddress | undefined
): string {
  const host = address?.host?.trim() ?? "";
  if (host !== "") {
    return host;
  }
  const url = address?.url?.trim() ?? "";
  if (url === "") {
    return "";
  }
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function publicAddressStatusLabel(address: ApNetworkPublicAddress): string {
  const status = address.status?.trim() || "Pending";
  const reason = address.reason?.trim();
  return reason == null || reason === "" ? status : `${status}: ${reason}`;
}

function publicAddressStatusDotClasses(address: ApNetworkPublicAddress): {
  inner: string;
  outer: string;
} {
  const status = address.status?.trim().toLowerCase();

  if (
    status === "accessible" ||
    status === "available" ||
    status === "ready" ||
    status === "running"
  ) {
    return { inner: "bg-green-500", outer: "bg-green-500/30" };
  }

  if (
    status === "progressing" ||
    status === "pending" ||
    status === "verifying" ||
    status === "creating"
  ) {
    return { inner: "bg-amber-500", outer: "bg-amber-500/30" };
  }

  if (
    status === "blocked" ||
    status === "failed" ||
    status === "error" ||
    status === "inaccessible" ||
    status === "unavailable"
  ) {
    return { inner: "bg-red-500", outer: "bg-red-500/30" };
  }

  return { inner: "bg-zinc-400", outer: "bg-zinc-400/30" };
}

function customDomainStatusLabel(domain: ApNetworkCustomDomain): string {
  const status = domain.status?.trim() || "Pending";
  const reason = domain.reason?.trim();
  return reason == null || reason === "" ? status : `${status}: ${reason}`;
}

interface PublicAddressStatusDotProps {
  address: Pick<ApNetworkPublicAddress, "status">;
  ariaLabel: string;
  className?: string;
  tooltip?: ReactNode;
}

function PublicAddressStatusDot({
  address,
  ariaLabel,
  className,
  tooltip,
}: PublicAddressStatusDotProps) {
  const classes = publicAddressStatusDotClasses({
    port: 1,
    status: address.status,
  });
  const dot = (
    <span
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-full",
        classes.outer
      )}
    >
      <span className={cn("size-2 rounded-full", classes.inner)} />
    </span>
  );

  if (tooltip == null) {
    return (
      <span
        aria-label={ariaLabel}
        className={className}
        role="img"
        title={ariaLabel}
      >
        {dot}
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          className
        )}
        type="button"
      >
        {dot}
      </TooltipTrigger>
      <TooltipContent align="start" className="max-w-72 text-left">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function publicAddressKey(
  address: ApNetworkPublicAddress,
  index: number
): string {
  return (
    address.id?.trim() ||
    address.host?.trim().toLowerCase() ||
    `pending-${index}`
  );
}

function customDomainKey(domain: ApNetworkCustomDomain, index: number): string {
  return (
    domain.id.trim() || domain.domain.trim().toLowerCase() || `cd-${index}`
  );
}

function platformAddressDraftFromPort(
  port: number,
  platformAddressDraftContext?: ApNetworkPlatformAddressDraftContext
): ApNetworkPublicAddressDraft {
  const id = generatePlatformAddressId();
  const domainPrefix = generatePlatformAddressDomainPrefix();
  const endpoint = platformAddressEndpoint({
    appName: platformAddressDraftContext?.appName ?? "",
    domainPrefix,
    namespace: platformAddressDraftContext?.namespace ?? "",
    platformAddressId: id,
    routingDomain: platformAddressDraftContext?.routingDomain ?? "",
  });
  return {
    ...(endpoint ?? {}),
    domainPrefix,
    id,
    port,
    status: "progressing",
    type: "platform",
  };
}

interface PublicAddressRowProps {
  address: ApNetworkPublicAddress;
  onBindCustomDomain?: () => void;
  onDelete?: () => void | Promise<void>;
  readOnly: boolean;
  rowKey: string;
}

function PublicAddressRow({
  address,
  onBindCustomDomain,
  onDelete,
  readOnly,
  rowKey,
}: PublicAddressRowProps) {
  const [pending, setPending] = useState(false);
  const value = publicAddressValue(address);
  const copyable = value !== "";

  const handleDelete = async () => {
    if (onDelete == null) {
      return;
    }
    setPending(true);
    try {
      await onDelete();
    } finally {
      setPending(false);
    }
  };

  return (
    <CanvasNode.CopyableRow
      className={cn(
        "relative flex min-h-17 min-w-0 items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-2 transition-colors",
        copyable && "hover:bg-input"
      )}
      copyAriaLabel="Copy Public Address"
      copyable={copyable}
      copyValue={value}
      rowKey={rowKey}
      title={copyable ? value : undefined}
    >
      {({ copyable: rowCopyable }) => (
        <>
          <div
            aria-hidden={rowCopyable ? true : undefined}
            className={cn(
              "relative z-10 grid min-w-0 flex-1 gap-2",
              rowCopyable ? "pointer-events-none" : "pointer-events-auto"
            )}
          >
            <div className="flex min-w-0 items-center gap-1.5 text-foreground text-sm leading-5">
              <PublicAddressStatusDot
                address={address}
                ariaLabel={`Public Address status: ${publicAddressStatusLabel(address)}`}
              />
              <span className="min-w-0 truncate">
                {value === "" ? "Pending domain" : value}
              </span>
              <CanvasNode.CopyableRowIndicator className="text-muted-foreground" />
            </div>
            <div className="min-w-0 truncate text-muted-foreground text-sm leading-5">
              {address.port}
            </div>
          </div>
          <CanvasNode.CopyableRowControl className="relative z-20 flex shrink-0 items-center gap-2">
            {readOnly || onBindCustomDomain == null ? null : (
              <AppIconButton
                aria-label="Edit Public Address"
                disabled={value === ""}
                onClick={onBindCustomDomain}
                size="lg"
                type="button"
                variant="secondary"
              >
                <Settings aria-hidden />
              </AppIconButton>
            )}
            {readOnly || onDelete == null ? null : (
              <AppIconButton
                aria-label="Delete Public Address"
                disabled={pending}
                onClick={handleDelete}
                size="lg"
                type="button"
                variant="danger"
              >
                <Trash2 aria-hidden />
              </AppIconButton>
            )}
          </CanvasNode.CopyableRowControl>
        </>
      )}
    </CanvasNode.CopyableRow>
  );
}

interface CustomDomainRowProps {
  domain: ApNetworkCustomDomain;
  onUnbind?: () => void | Promise<void>;
  readOnly: boolean;
}

function lifecycleDetailLabel(
  label: string,
  detail: ApNetworkCustomDomainDetail | undefined
): string {
  const status = detail?.status?.trim().toLowerCase() || "unknown";
  return `${label} ${status}`;
}

function lifecycleDetailText(
  detail: ApNetworkCustomDomainDetail | undefined
): string {
  const reason = detail?.reason?.trim() ?? "";
  const message = detail?.message?.trim() ?? "";
  if (reason !== "" && message !== "") {
    return `${reason}: ${message}`;
  }
  return reason || message;
}

function customDomainLifecycleDetails(domain: ApNetworkCustomDomain): string[] {
  return [
    ["DNS", domain.dns] as const,
    ["Certificate", domain.certificate] as const,
    ["Routing", domain.routing] as const,
  ].map(([label, detail]) => {
    const summary = lifecycleDetailLabel(label, detail);
    const text = lifecycleDetailText(detail);
    return text === "" ? summary : `${summary}: ${text}`;
  });
}

function customDomainStatusAriaLabel(domain: ApNetworkCustomDomain): string {
  return [
    `Custom Domain status: ${customDomainStatusLabel(domain)}`,
    ...customDomainLifecycleDetails(domain),
  ].join("; ");
}

function CustomDomainStatusTooltip({
  domain,
}: {
  domain: ApNetworkCustomDomain;
}) {
  const details = customDomainLifecycleDetails(domain);

  return (
    <div className="grid gap-1">
      <div className="font-medium">
        Custom Domain status: {customDomainStatusLabel(domain)}
      </div>
      {details.map((detail) => (
        <div className="text-background/80" key={detail}>
          {detail}
        </div>
      ))}
    </div>
  );
}

function CustomDomainRow({ domain, onUnbind, readOnly }: CustomDomainRowProps) {
  const [pending, setPending] = useState(false);
  const handleUnbind = async () => {
    if (onUnbind == null) {
      return;
    }
    setPending(true);
    try {
      await onUnbind();
    } finally {
      setPending(false);
    }
  };
  const targetPort = domain.targetPort ?? undefined;
  const targetText =
    domain.cnameTarget == null || domain.cnameTarget.trim() === ""
      ? domain.platformAddressId
      : domain.cnameTarget.trim();
  const detailText = targetPort == null ? targetText : String(targetPort);
  const statusAriaLabel = customDomainStatusAriaLabel(domain);

  return (
    <div className="flex min-h-17 min-w-0 items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-2">
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-foreground text-sm leading-5">
          <PublicAddressStatusDot
            address={{ status: domain.status }}
            ariaLabel={statusAriaLabel}
            tooltip={<CustomDomainStatusTooltip domain={domain} />}
          />
          <span className="min-w-0 truncate">{domain.domain}</span>
        </div>
        <div className="min-w-0 truncate text-muted-foreground text-sm leading-5">
          {detailText}
        </div>
      </div>
      {readOnly || onUnbind == null ? null : (
        <AppIconButton
          aria-label="Unbind Custom Domain"
          disabled={pending}
          onClick={handleUnbind}
          size="lg"
          title="Unbind Custom Domain"
          type="button"
          variant="danger"
        >
          <Trash2 aria-hidden />
        </AppIconButton>
      )}
    </div>
  );
}

function normalizeCustomDomainDraft(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/g, "");
}

interface NetworkCardProps {
  actions?: ReactNode;
  children: ReactNode;
  title: string;
}

function NetworkCard({ actions, children, title }: NetworkCardProps) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border">
      <div className="flex h-11 min-w-0 items-center gap-1.5 border-border border-b px-2.5">
        <Network
          aria-hidden
          className="size-4 shrink-0 text-foreground"
          strokeWidth={2}
        />
        <Label className="min-w-0 truncate font-medium text-foreground text-sm">
          {title}
        </Label>
        {actions == null ? null : (
          <div className="ml-auto flex shrink-0 items-center">{actions}</div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2 px-2.5 pb-3">{children}</div>
    </section>
  );
}

interface PrivateAddressRowProps {
  address: string;
  affectedPublicAddressCount: number;
  canDelete: boolean;
  onDelete?: () => void;
  port: number;
  readOnly: boolean;
  rowKey: string;
}

function PrivateAddressRow({
  affectedPublicAddressCount,
  address,
  canDelete,
  onDelete,
  port,
  readOnly,
  rowKey,
}: PrivateAddressRowProps) {
  const copyable = address.trim() !== "";
  const countLabel =
    affectedPublicAddressCount === 1
      ? "1 Public Address"
      : `${affectedPublicAddressCount} Public Addresses`;

  return (
    <CanvasNode.CopyableRow
      className={cn(
        "relative flex min-h-17 min-w-0 items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-2 transition-colors",
        copyable && "hover:bg-input"
      )}
      copyAriaLabel="Copy Private Address"
      copyable={copyable}
      copyValue={address}
      rowKey={rowKey}
      title={copyable ? address : undefined}
    >
      {({ copyable: rowCopyable }) => (
        <>
          <div
            aria-hidden={rowCopyable ? true : undefined}
            className={cn(
              "relative z-10 grid min-w-0 flex-1 gap-2",
              rowCopyable ? "pointer-events-none" : "pointer-events-auto"
            )}
          >
            <div className="flex min-w-0 items-center gap-1.5 text-foreground text-sm leading-5">
              <span className="min-w-0 truncate">
                {copyable ? address : "Pending"}
              </span>
              <CanvasNode.CopyableRowIndicator className="text-muted-foreground" />
            </div>
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-sm leading-5">
              <span className="shrink-0 tabular-nums">{port}</span>
              <span className="min-w-0 truncate">{countLabel}</span>
            </div>
          </div>
          <CanvasNode.CopyableRowControl className="relative z-20 flex shrink-0 items-center gap-2">
            {readOnly || onDelete == null ? null : (
              <AppIconButton
                aria-label={`Delete App Listening Port ${port}`}
                disabled={!canDelete}
                onClick={onDelete}
                size="lg"
                title={
                  canDelete
                    ? `Delete App Listening Port ${port}`
                    : "At least one App Listening Port is required"
                }
                type="button"
                variant="danger"
              >
                <Trash2 aria-hidden />
              </AppIconButton>
            )}
          </CanvasNode.CopyableRowControl>
        </>
      )}
    </CanvasNode.CopyableRow>
  );
}

interface DeletePortDialogTarget {
  affectedPublicAddresses: ApNetworkPublicAddress[];
  port: number;
}

interface DeletePortDialogProps {
  onConfirm: (port: number) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  target: DeletePortDialogTarget | null;
}

function DeletePortDialog({
  onConfirm,
  onOpenChange,
  open,
  target,
}: DeletePortDialogProps) {
  if (target == null) {
    return null;
  }
  const visible = target.affectedPublicAddresses.slice(0, 3);
  const remaining = Math.max(0, target.affectedPublicAddresses.length - 3);

  return (
    <AppDialog.Root onOpenChange={onOpenChange} open={open}>
      <AppDialog.Content data-slot="delete-app-listening-port-dialog">
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>Delete App Listening Port?</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            Public Addresses targeting port {target.port} will be blocked until
            the port is added back or their target port changes.
          </AppDialog.Description>
          {visible.length === 0 ? null : (
            <div className="grid gap-1 text-muted-foreground text-sm">
              {visible.map((address) => (
                <div
                  className="min-w-0 truncate rounded-md bg-white/5 px-2 py-1"
                  key={
                    publicAddressIdValue(address) ||
                    publicAddressDisplayName(address)
                  }
                >
                  {publicAddressDisplayName(address)}
                </div>
              ))}
              {remaining === 0 ? null : (
                <div className="px-2 py-1">
                  +{remaining} more Public{" "}
                  {remaining === 1 ? "Address" : "Addresses"}
                </div>
              )}
            </div>
          )}
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel>Cancel</AppDialog.Cancel>
          <AppDialog.DestructiveAction
            onClick={() => onConfirm(target.port)}
            type="button"
          >
            Delete Port
          </AppDialog.DestructiveAction>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

interface AddAppListeningPortFormProps {
  existingPorts: readonly ApNetworkAppListeningPort[];
  onCancel: () => void;
  onSubmit: (port: number) => void;
}

function AddAppListeningPortForm({
  existingPorts,
  onCancel,
  onSubmit,
}: AddAppListeningPortFormProps) {
  const addressInputId = useId();
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const parsed = parsePortNumberDigits(draft.trim());
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    if (existingPorts.some((row) => Math.round(row.port) === parsed.n)) {
      setError("App Listening Port already exists.");
      return;
    }
    onSubmit(parsed.n);
    onCancel();
  };

  return (
    <div className="grid min-w-0 gap-4 rounded-lg border border-border border-dashed bg-transparent p-2.5">
      <AppInputField
        disabled
        id={addressInputId}
        label="Address"
        value="Pending address"
      />
      <AppInputField
        error={error}
        errorId={errorId}
        id={inputId}
        inputMode="numeric"
        label="Port"
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        placeholder="3000"
        value={draft}
      />
      <div className="flex min-w-0 justify-end gap-2">
        <AppButton
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          onClick={onCancel}
          type="button"
          variant="quiet"
        >
          <X aria-hidden data-icon="inline-start" />
          Cancel
        </AppButton>
        <AppButton
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          onClick={handleSubmit}
          type="button"
          variant="quiet"
        >
          <Plus aria-hidden data-icon="inline-start" />
          Add
        </AppButton>
      </div>
    </div>
  );
}

interface AddPublicAddressFormProps {
  defaultPort: number;
  onCancel: () => void;
  onSubmit?: (
    address: ApNetworkPublicAddressDraft,
    customDomain?: ApNetworkCustomDomain
  ) => void | Promise<void>;
  platformAddressDraftContext?: ApNetworkPlatformAddressDraftContext;
  verify?: ApCustomDomainCnameVerifier;
}

async function verifiedCustomDomainDraft({
  cnameTarget,
  domain,
  platformAddressId,
  port,
  verify,
}: {
  cnameTarget: string;
  domain: string;
  platformAddressId: string;
  port: number;
  verify: ApCustomDomainCnameVerifier;
}): Promise<ApNetworkCustomDomain | { error: string }> {
  let result: ApCustomDomainCnameVerificationResult;
  try {
    result = await verify({ domain, target: cnameTarget });
  } catch (caught) {
    return {
      error:
        caught instanceof Error ? caught.message : "CNAME verification failed.",
    };
  }
  if (!result.ok) {
    return { error: result.message ?? "CNAME verification failed." };
  }
  return {
    cnameTarget,
    dns: {
      status: "verified",
      target: cnameTarget,
      verifiedAt: new Date().toISOString(),
    },
    domain,
    id: generateCustomDomainBindingId(),
    platformAddressId,
    targetPort: port,
  };
}

interface PublicAddressEditFormProps {
  address: ApNetworkPublicAddress;
  onCancel: () => void;
  onSubmit?: (
    address: ApNetworkPublicAddress,
    port: number,
    customDomain?: ApNetworkCustomDomain
  ) => void | Promise<void>;
  verify?: ApCustomDomainCnameVerifier;
}

function PublicAddressEditForm({
  address,
  onCancel,
  onSubmit,
  verify,
}: PublicAddressEditFormProps) {
  const domainInputId = useId();
  const portInputId = useId();
  const cnameHostInputId = useId();
  const cnameTargetInputId = useId();
  const portErrorId = `${portInputId}-error`;
  const cnameErrorId = `${cnameHostInputId}-error`;
  const domainValue = publicAddressValue(address) || "Pending domain";
  const cnameTarget = publicAddressHostValue(address);
  const platformAddressId = publicAddressIdValue(address);
  const [draftPort, setDraftPort] = useState(() => String(address.port));
  const [cnameHostDraft, setCnameHostDraft] = useState("");
  const [portError, setPortError] = useState<string | null>(null);
  const [cnameError, setCnameError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const normalizedCnameHost = normalizeCustomDomainDraft(cnameHostDraft);

  const handleSubmit = async () => {
    if (onSubmit == null) {
      return;
    }
    const parsedPort = parsePortNumberDigits(draftPort.trim());
    if (!parsedPort.ok) {
      setPortError(parsedPort.message);
      return;
    }
    if (normalizedCnameHost === "") {
      await onSubmit(address, parsedPort.n);
      onCancel();
      return;
    }
    if (cnameTarget === "" || platformAddressId === "") {
      setCnameError("Platform Address host is not ready.");
      return;
    }
    if (verify == null) {
      setCnameError("CNAME verification is unavailable.");
      return;
    }

    setPending(true);
    try {
      const verified = await verifiedCustomDomainDraft({
        cnameTarget,
        domain: normalizedCnameHost,
        platformAddressId,
        port: parsedPort.n,
        verify,
      });
      if ("error" in verified) {
        setCnameError(verified.error);
        return;
      }
      await onSubmit(address, parsedPort.n, verified);
      onCancel();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-w-0 gap-4 rounded-lg border border-border border-dashed bg-transparent p-2.5">
      <AppInputField
        disabled
        id={domainInputId}
        label="Domain"
        value={domainValue}
      />
      <AppInputField
        disabled={pending}
        error={portError}
        errorId={portErrorId}
        id={portInputId}
        inputMode="numeric"
        label="Port"
        onChange={(event) => {
          setDraftPort(event.target.value);
          setPortError(null);
        }}
        value={draftPort}
      />
      <AppInputField
        disabled={pending}
        error={cnameError}
        errorId={cnameErrorId}
        id={cnameHostInputId}
        label="Custom Domain"
        onChange={(event) => {
          setCnameHostDraft(event.target.value);
          setCnameError(null);
        }}
        placeholder="www.example.com"
        value={cnameHostDraft}
      />
      <AppInputField
        disabled
        id={cnameTargetInputId}
        label="CNAME Target"
        value={cnameTarget === "" ? "Pending domain" : cnameTarget}
      />
      <div className="flex min-w-0 justify-end gap-2">
        <AppButton
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          disabled={pending}
          onClick={onCancel}
          type="button"
          variant="quiet"
        >
          <X aria-hidden data-icon="inline-start" />
          Cancel
        </AppButton>
        <AppButton
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          disabled={pending || onSubmit == null}
          onClick={handleSubmit}
          type="button"
          variant="quiet"
        >
          {pending ? "Verifying" : "Save"}
        </AppButton>
      </div>
    </div>
  );
}

function AddPublicAddressForm({
  defaultPort,
  onCancel,
  onSubmit,
  platformAddressDraftContext,
  verify,
}: AddPublicAddressFormProps) {
  const domainInputId = useId();
  const portInputId = useId();
  const cnameHostInputId = useId();
  const cnameTargetInputId = useId();
  const errorId = `${portInputId}-error`;
  const cnameErrorId = `${cnameHostInputId}-error`;
  const [draftAddress] = useState(() =>
    platformAddressDraftFromPort(defaultPort, platformAddressDraftContext)
  );
  const [draftPort, setDraftPort] = useState(() => String(defaultPort));
  const [cnameHostDraft, setCnameHostDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cnameError, setCnameError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const domainValue = publicAddressHostValue(draftAddress) || "Pending domain";
  const cnameTarget = publicAddressHostValue(draftAddress);
  const normalizedCnameHost = normalizeCustomDomainDraft(cnameHostDraft);

  const handleSubmit = async () => {
    if (onSubmit == null) {
      return;
    }
    const parsedPort = parsePortNumberDigits(draftPort.trim());
    if (!parsedPort.ok) {
      setError(parsedPort.message);
      return;
    }
    if (normalizedCnameHost !== "" && cnameTarget === "") {
      setCnameError("Platform Address host is not ready.");
      return;
    }
    if (normalizedCnameHost !== "" && verify == null) {
      setCnameError("CNAME verification is unavailable.");
      return;
    }

    setPending(true);
    try {
      let customDomain: ApNetworkCustomDomain | undefined;
      if (normalizedCnameHost !== "") {
        const verifier = verify;
        if (verifier == null) {
          setCnameError("CNAME verification is unavailable.");
          return;
        }
        const verified = await verifiedCustomDomainDraft({
          cnameTarget,
          domain: normalizedCnameHost,
          platformAddressId: draftAddress.id,
          port: parsedPort.n,
          verify: verifier,
        });
        if ("error" in verified) {
          setCnameError(verified.error);
          return;
        }
        customDomain = verified;
      }
      await onSubmit({ ...draftAddress, port: parsedPort.n }, customDomain);
    } finally {
      setPending(false);
    }
    onCancel();
  };

  return (
    <div className="grid min-w-0 gap-4 rounded-lg border border-border border-dashed bg-transparent p-2.5">
      <AppInputField
        disabled
        id={domainInputId}
        label="Domain"
        value={domainValue}
      />
      <AppInputField
        disabled={pending}
        error={error}
        errorId={errorId}
        id={portInputId}
        inputMode="numeric"
        label="Port"
        onChange={(event) => {
          setDraftPort(event.target.value);
          setError(null);
        }}
        value={draftPort}
      />
      <AppInputField
        disabled={pending}
        error={cnameError}
        errorId={cnameErrorId}
        id={cnameHostInputId}
        label="CNAME Host"
        onChange={(event) => {
          setCnameHostDraft(event.target.value);
          setCnameError(null);
        }}
        placeholder="www.example.com"
        value={cnameHostDraft}
      />
      <AppInputField
        disabled
        id={cnameTargetInputId}
        label="CNAME Target"
        value={cnameTarget === "" ? "Pending domain" : cnameTarget}
      />
      <div className="flex min-w-0 justify-end gap-2">
        <AppButton
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          disabled={pending}
          onClick={onCancel}
          type="button"
          variant="quiet"
        >
          <X aria-hidden data-icon="inline-start" />
          Cancel
        </AppButton>
        <AppButton
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          disabled={pending || onSubmit == null}
          onClick={handleSubmit}
          type="button"
          variant="quiet"
        >
          <Plus aria-hidden data-icon="inline-start" />
          Add
        </AppButton>
      </div>
    </div>
  );
}

interface DomainListSectionProps {
  addOpen: boolean;
  canMutateNetwork: boolean;
  defaultPort: number;
  expandedCnameRowKeys: ReadonlySet<string>;
  onAddPublicAddress: (
    address: ApNetworkPublicAddressDraft,
    customDomain?: ApNetworkCustomDomain
  ) => void | Promise<void>;
  onBindAddress: (
    rowKey: string,
    row: ApNetworkVisiblePublicAddressRow,
    port: number,
    customDomain?: ApNetworkCustomDomain
  ) => void | Promise<void>;
  onCancelAddPublicAddress: () => void;
  onCancelBindAddress: (rowKey: string) => void;
  onCollapsePublicAddresses: () => void;
  onDeletePublicAddress: (
    row: ApNetworkVisiblePublicAddressRow
  ) => void | Promise<void>;
  onOpenAddPublicAddress: () => void;
  onOpenBindAddress: (rowKey: string) => void;
  onShowAllPublicAddresses: () => void;
  onUnbindCustomDomain: (domain: ApNetworkCustomDomain) => void | Promise<void>;
  platformAddressDraftContext?: ApNetworkPlatformAddressDraftContext;
  readOnly: boolean;
  showAllPublicAddresses: boolean;
  verify?: ApCustomDomainCnameVerifier;
  visibleDomainRows: ApNetworkVisibleDomainRows;
  visiblePublicAddressRows: ApNetworkVisiblePublicAddressRow[];
}

function DomainListSection({
  addOpen,
  canMutateNetwork,
  defaultPort,
  expandedCnameRowKeys,
  onAddPublicAddress,
  onBindAddress,
  onCancelBindAddress,
  onCancelAddPublicAddress,
  onCollapsePublicAddresses,
  onDeletePublicAddress,
  onOpenBindAddress,
  onOpenAddPublicAddress,
  onShowAllPublicAddresses,
  onUnbindCustomDomain,
  platformAddressDraftContext,
  readOnly,
  showAllPublicAddresses,
  verify,
  visibleDomainRows,
  visiblePublicAddressRows,
}: DomainListSectionProps) {
  const noDomains =
    visibleDomainRows.publicAddressRows.length === 0 &&
    visibleDomainRows.customDomains.length === 0;
  const hasPublicAddressOverflow =
    visibleDomainRows.publicAddressRows.length > PUBLIC_ADDRESS_VISIBLE_COUNT;

  return (
    <NetworkCard title="Domain List">
      {readOnly ? null : (
        <AppButton
          aria-label="Add Public Address"
          className="h-9 w-full rounded-lg bg-white/5 text-muted-foreground text-sm hover:bg-input"
          disabled={addOpen || !canMutateNetwork}
          onClick={onOpenAddPublicAddress}
          type="button"
          variant="secondary"
        >
          <Plus aria-hidden />
          Add Domain
        </AppButton>
      )}
      {addOpen ? (
        <AddPublicAddressForm
          defaultPort={defaultPort}
          onCancel={onCancelAddPublicAddress}
          onSubmit={canMutateNetwork ? onAddPublicAddress : undefined}
          platformAddressDraftContext={platformAddressDraftContext}
          verify={verify}
        />
      ) : null}
      {noDomains ? (
        <div className="rounded-md border border-border border-dashed px-2.5 py-3 text-center text-muted-foreground text-xs">
          No public addresses yet
        </div>
      ) : (
        <CanvasNode.CopyFeedbackScope>
          <div className="grid gap-2">
            {visibleDomainRows.customDomains.map((domain, index) => (
              <CustomDomainRow
                domain={domain}
                key={customDomainKey(domain, index)}
                onUnbind={
                  canMutateNetwork
                    ? () => onUnbindCustomDomain(domain)
                    : undefined
                }
                readOnly={readOnly}
              />
            ))}
            {visiblePublicAddressRows.map((row) => {
              const { address } = row;
              const key = publicAddressKey(address, row.publicAddressIndex);
              return expandedCnameRowKeys.has(key) ? (
                <PublicAddressEditForm
                  address={address}
                  key={key}
                  onCancel={() => onCancelBindAddress(key)}
                  onSubmit={
                    canMutateNetwork
                      ? (submittedAddress, port, customDomain) =>
                          onBindAddress(
                            key,
                            {
                              ...row,
                              address: submittedAddress,
                            },
                            port,
                            customDomain
                          )
                      : undefined
                  }
                  verify={verify}
                />
              ) : (
                <PublicAddressRow
                  address={address}
                  key={key}
                  onBindCustomDomain={
                    canMutateNetwork ? () => onOpenBindAddress(key) : undefined
                  }
                  onDelete={
                    canMutateNetwork
                      ? () => onDeletePublicAddress(row)
                      : undefined
                  }
                  readOnly={readOnly}
                  rowKey={key}
                />
              );
            })}
          </div>
        </CanvasNode.CopyFeedbackScope>
      )}
      {hasPublicAddressOverflow ? (
        <button
          aria-expanded={showAllPublicAddresses}
          aria-label={
            showAllPublicAddresses
              ? "Show Less Public Addresses"
              : "View All Public Addresses"
          }
          className="inline-flex h-5 shrink-0 cursor-pointer select-none items-center justify-center justify-self-center whitespace-nowrap rounded-lg border border-transparent bg-transparent bg-clip-padding px-2 font-medium text-muted-foreground text-xs leading-5 outline-none transition-colors hover:bg-input/30 hover:text-foreground focus-visible:border-ring focus-visible:bg-input/30 focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={
            showAllPublicAddresses
              ? onCollapsePublicAddresses
              : onShowAllPublicAddresses
          }
          type="button"
        >
          {showAllPublicAddresses ? "Show Less" : "View All"}
        </button>
      ) : null}
    </NetworkCard>
  );
}

export function NetworkSettingsSection({
  controller,
  onCustomDomainCnameVerify,
  platformAddressDraftContext,
  readOnly,
}: NetworkSettingsSectionProps) {
  const { network } = controller;
  const appListeningPorts = appListeningPortsFromNetwork(network);
  const [addPortOpen, setAddPortOpen] = useState(false);
  const [addPublicAddressOpen, setAddPublicAddressOpen] = useState(false);
  const [showAllPublicAddresses, setShowAllPublicAddresses] = useState(false);
  const [expandedCnameRowKeys, setExpandedCnameRowKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [deletePortTarget, setDeletePortTarget] =
    useState<DeletePortDialogTarget | null>(null);
  const visibleDomains = visibleDomainRows(network);
  const canMutateNetwork = controller.canMutate;
  const visiblePublicAddressRows = showAllPublicAddresses
    ? visibleDomains.publicAddressRows
    : visibleDomains.publicAddressRows.slice(0, PUBLIC_ADDRESS_VISIBLE_COUNT);

  useEffect(() => {
    if (
      visibleDomains.publicAddressRows.length <= PUBLIC_ADDRESS_VISIBLE_COUNT
    ) {
      setShowAllPublicAddresses(false);
    }
  }, [visibleDomains.publicAddressRows.length]);

  const handleCancelAddPublicAddress = () => {
    setAddPublicAddressOpen(false);
  };

  const handleAddAppListeningPort = async (port: number) => {
    await controller.addAppListeningPort(port);
  };

  const commitDeleteAppListeningPort = async (port: number) => {
    await controller.deleteAppListeningPort(port);
  };

  const handleDeleteAppListeningPort = async (port: number) => {
    if (appListeningPorts.length <= 1) {
      return;
    }
    const affected = publicAddressesTargetingPort(network, port);
    if (affected.length > 0) {
      setDeletePortTarget({ affectedPublicAddresses: affected, port });
      return;
    }
    await commitDeleteAppListeningPort(port);
  };

  const handleConfirmDeleteAppListeningPort = async (port: number) => {
    setDeletePortTarget(null);
    await commitDeleteAppListeningPort(port);
  };

  const handleAddPublicAddress = async (
    address: ApNetworkPublicAddressDraft,
    customDomain?: ApNetworkCustomDomain
  ) => {
    await controller.addPublicAddress(address, customDomain);
  };

  const handleDeletePublicAddress = async (
    row: ApNetworkVisiblePublicAddressRow
  ) => {
    await controller.deletePublicAddress(row);
  };

  const handleOpenBindAddress = (rowKey: string) => {
    setExpandedCnameRowKeys((current) => new Set(current).add(rowKey));
  };

  const handleCancelBindAddress = (rowKey: string) => {
    setExpandedCnameRowKeys((current) => {
      const next = new Set(current);
      next.delete(rowKey);
      return next;
    });
  };

  const handleBindCustomDomain = async (
    rowKey: string,
    row: ApNetworkVisiblePublicAddressRow,
    port: number,
    domain?: ApNetworkCustomDomain
  ) => {
    await controller.bindCustomDomain(row, port, domain);
    handleCancelBindAddress(rowKey);
  };

  const handleUnbindCustomDomain = async (domain: ApNetworkCustomDomain) => {
    await controller.unbindCustomDomain(domain);
  };

  return (
    <>
      <NetworkCard title="Private Addresses">
        {readOnly ? null : (
          <AppButton
            aria-label="Add App Listening Port"
            className="h-9 w-full rounded-lg bg-white/5 text-muted-foreground text-sm hover:bg-input"
            disabled={addPortOpen || !canMutateNetwork}
            onClick={() => setAddPortOpen(true)}
            type="button"
            variant="secondary"
          >
            <Plus aria-hidden />
            Add Port
          </AppButton>
        )}
        {addPortOpen ? (
          <AddAppListeningPortForm
            existingPorts={appListeningPorts}
            onCancel={() => setAddPortOpen(false)}
            onSubmit={handleAddAppListeningPort}
          />
        ) : null}
        <CanvasNode.CopyFeedbackScope>
          <div className="grid gap-2">
            {appListeningPorts.map((row) => (
              <PrivateAddressRow
                address={row.privateAddress ?? ""}
                affectedPublicAddressCount={
                  publicAddressesTargetingPort(network, row.port).length
                }
                canDelete={appListeningPorts.length > 1}
                key={`private-${row.port}`}
                onDelete={
                  canMutateNetwork
                    ? () => handleDeleteAppListeningPort(row.port)
                    : undefined
                }
                port={row.port}
                readOnly={readOnly}
                rowKey={`private-${row.port}`}
              />
            ))}
          </div>
        </CanvasNode.CopyFeedbackScope>
      </NetworkCard>

      <DomainListSection
        addOpen={addPublicAddressOpen}
        canMutateNetwork={canMutateNetwork}
        defaultPort={publicAddressDefaultPort(network)}
        expandedCnameRowKeys={expandedCnameRowKeys}
        onAddPublicAddress={handleAddPublicAddress}
        onBindAddress={handleBindCustomDomain}
        onCancelAddPublicAddress={handleCancelAddPublicAddress}
        onCancelBindAddress={handleCancelBindAddress}
        onCollapsePublicAddresses={() => setShowAllPublicAddresses(false)}
        onDeletePublicAddress={handleDeletePublicAddress}
        onOpenAddPublicAddress={() => setAddPublicAddressOpen(true)}
        onOpenBindAddress={handleOpenBindAddress}
        onShowAllPublicAddresses={() => setShowAllPublicAddresses(true)}
        onUnbindCustomDomain={handleUnbindCustomDomain}
        platformAddressDraftContext={platformAddressDraftContext}
        readOnly={readOnly}
        showAllPublicAddresses={showAllPublicAddresses}
        verify={onCustomDomainCnameVerify}
        visibleDomainRows={visibleDomains}
        visiblePublicAddressRows={visiblePublicAddressRows}
      />
      <DeletePortDialog
        onConfirm={handleConfirmDeleteAppListeningPort}
        onOpenChange={(open) => {
          if (!open) {
            setDeletePortTarget(null);
          }
        }}
        open={deletePortTarget != null}
        target={deletePortTarget}
      />
    </>
  );
}

function publicAddressNetworkDirty(base: ApNetwork, draft: ApNetwork): boolean {
  return !apNetworksEqual(base, draft);
}

export function useApPublicAddressesSettingsSections({
  identityKey,
  network,
  networkPlatformAddressDraftContext,
  onCustomDomainCnameVerify,
  onNetworkDraftCommit,
  readOnly = false,
}: ApPublicAddressesSettingsSectionsProps): ApSettingsSectionsModel {
  const commitMode = onNetworkDraftCommit != null && readOnly !== true;
  const [draftNetwork, setDraftNetwork] = useState(network);
  const [savePending, setSavePending] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [portNotice, setPortNotice] = useState<string | null>(null);
  const [showAllPublicAddresses, setShowAllPublicAddresses] = useState(false);
  const [expandedCnameRowKeys, setExpandedCnameRowKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());

  useEffect(() => {
    if (commitMode) {
      return;
    }
    setDraftNetwork((current) =>
      apNetworksEqual(current, network) ? current : network
    );
  }, [commitMode, network]);

  const networkBackingKey = useMemo(
    () => apNetworkDraftBackingKey(network),
    [network]
  );
  const [networkBackingState, setNetworkBackingState] = useState(() =>
    createSettingsDraftBackingState(network, networkBackingKey, identityKey)
  );
  const applyNetworkDraftToLocalState = useCallback((next: ApNetwork) => {
    setDraftNetwork(next);
  }, []);

  useEffect(() => {
    if (!commitMode) {
      return;
    }
    const synced = syncSettingsDraftBackingState(networkBackingState, {
      backing: network,
      backingKey: networkBackingKey,
      draft: draftNetwork,
      identityKey,
      isDirty: publicAddressNetworkDirty,
    });
    if (synced.state === networkBackingState && synced.draft === undefined) {
      return;
    }
    applySettingsDraftBackingResult(synced, {
      draft: applyNetworkDraftToLocalState,
      state: setNetworkBackingState,
    });
  }, [
    applyNetworkDraftToLocalState,
    commitMode,
    draftNetwork,
    identityKey,
    network,
    networkBackingKey,
    networkBackingState,
  ]);

  const networkForRender = commitMode ? draftNetwork : network;
  const visibleDomains = visibleDomainRows(networkForRender);
  const visiblePublicAddressRows = showAllPublicAddresses
    ? visibleDomains.publicAddressRows
    : visibleDomains.publicAddressRows.slice(0, PUBLIC_ADDRESS_VISIBLE_COUNT);
  const networkDirty = publicAddressNetworkDirty(
    networkBackingState.base,
    draftNetwork
  );
  const canSave = commitMode && networkDirty && !savePending;

  useEffect(() => {
    if (
      visibleDomains.publicAddressRows.length <= PUBLIC_ADDRESS_VISIBLE_COUNT
    ) {
      setShowAllPublicAddresses(false);
    }
  }, [visibleDomains.publicAddressRows.length]);

  const resetNetworkDraft = useCallback(() => {
    applyNetworkDraftToLocalState(networkBackingState.base);
    setNetworkBackingState((current) => ({
      ...current,
      saveFailureMessage: null,
    }));
  }, [applyNetworkDraftToLocalState, networkBackingState.base]);

  const reloadNetworkDraft = useCallback(() => {
    applySettingsDraftBackingResult(
      reloadSettingsDraftBackingState(networkBackingState),
      {
        draft: applyNetworkDraftToLocalState,
        state: setNetworkBackingState,
      }
    );
  }, [applyNetworkDraftToLocalState, networkBackingState]);

  const keepEditingNetworkDraft = useCallback(() => {
    setNetworkBackingState((current) =>
      keepEditingSettingsDraftBackingState(current)
    );
  }, []);

  const saveNetworkDraft = useCallback(async () => {
    if (!canSave || onNetworkDraftCommit == null) {
      throw new Error("Public Address draft cannot be saved yet.");
    }
    const draft = draftNetwork;
    const prepared = prepareSettingsDraftSubmit(networkBackingState, {
      conflictMessage: PUBLIC_ADDRESS_SUBMIT_CONFLICT_MESSAGE,
      domains: PUBLIC_ADDRESS_DRAFT_DOMAINS,
      draft,
      isDomainDirty: (_domain, base, next) => !apNetworksEqual(base, next),
      mergeDraft: ({ draft: next }) => next,
    });
    setNetworkBackingState(prepared.state);
    if (prepared.status === "conflict") {
      throw new Error(PUBLIC_ADDRESS_SUBMIT_CONFLICT_MESSAGE);
    }
    setSavePending(true);
    setNetworkBackingState((current) => ({
      ...current,
      saveFailureMessage: null,
    }));
    try {
      await onNetworkDraftCommit(prepared.draft, {
        baseNetwork: prepared.base,
      });
      setNetworkBackingState((current) =>
        commitSettingsDraftBackingState(
          current,
          prepared.draft,
          apNetworkDraftBackingKey(prepared.draft)
        )
      );
      setDraftNetwork(prepared.draft);
    } catch (error) {
      setNetworkBackingState((current) =>
        failSettingsDraftSave(
          current,
          error,
          "Could not save public addresses."
        )
      );
      throw error;
    } finally {
      setSavePending(false);
    }
  }, [canSave, draftNetwork, networkBackingState, onNetworkDraftCommit]);

  const handleSaveNetworkDraft = useCallback(async () => {
    try {
      await saveNetworkDraft();
    } catch {
      // The footer keeps the user on the draft and shows the panel-level failure.
    }
  }, [saveNetworkDraft]);

  const applyPublicAddressDraftNetwork = useCallback(
    (next: ApNetwork) => {
      const addedPorts = addedAppListeningPorts(networkForRender, next);
      if (addedPorts.length > 0) {
        setPortNotice(`Port ${addedPorts[0]} added to Private Addresses.`);
      }
      setDraftNetwork(next);
    },
    [networkForRender]
  );
  const controller = useApNetworkDraftController({
    network: networkForRender,
    onNetworkChange: commitMode ? applyPublicAddressDraftNetwork : undefined,
    readOnly,
  });
  const canMutateNetwork = controller.canMutate;

  const leaveGuard: SettingsLeaveGuardHandle | null =
    commitMode && networkDirty
      ? {
          canSave,
          dirty: true,
          discard: resetNetworkDraft,
          save: saveNetworkDraft,
          scope: "publicAddresses",
        }
      : null;

  const handleOpenBindAddress = (rowKey: string) => {
    setExpandedCnameRowKeys((current) => new Set(current).add(rowKey));
  };

  const handleCancelBindAddress = (rowKey: string) => {
    setExpandedCnameRowKeys((current) => {
      const next = new Set(current);
      next.delete(rowKey);
      return next;
    });
  };

  const handleBindCustomDomain = async (
    rowKey: string,
    row: ApNetworkVisiblePublicAddressRow,
    port: number,
    domain?: ApNetworkCustomDomain
  ) => {
    await controller.bindCustomDomain(row, port, domain);
    handleCancelBindAddress(rowKey);
  };

  return {
    footer: commitMode ? (
      <ApSettingsDraftFooter
        canSave={canSave}
        conflictMessage={networkBackingState.submitConflictMessage}
        dirty={networkDirty}
        discardAriaLabel="Discard Public Address changes"
        onCancel={resetNetworkDraft}
        onKeepEditing={keepEditingNetworkDraft}
        onReload={reloadNetworkDraft}
        onSave={handleSaveNetworkDraft}
        pending={savePending}
        saveFailureMessage={networkBackingState.saveFailureMessage}
        submitAriaLabel="Update Public Address settings"
      />
    ) : null,
    leaveGuard,
    sections: [
      {
        content: (
          <>
            <DomainListSection
              addOpen={addOpen}
              canMutateNetwork={canMutateNetwork}
              defaultPort={networkForRender.privatePort}
              expandedCnameRowKeys={expandedCnameRowKeys}
              onAddPublicAddress={controller.addPublicAddress}
              onBindAddress={handleBindCustomDomain}
              onCancelAddPublicAddress={() => setAddOpen(false)}
              onCancelBindAddress={handleCancelBindAddress}
              onCollapsePublicAddresses={() => setShowAllPublicAddresses(false)}
              onDeletePublicAddress={controller.deletePublicAddress}
              onOpenAddPublicAddress={() => setAddOpen(true)}
              onOpenBindAddress={handleOpenBindAddress}
              onShowAllPublicAddresses={() => setShowAllPublicAddresses(true)}
              onUnbindCustomDomain={controller.unbindCustomDomain}
              platformAddressDraftContext={networkPlatformAddressDraftContext}
              readOnly={readOnly}
              showAllPublicAddresses={showAllPublicAddresses}
              verify={onCustomDomainCnameVerify}
              visibleDomainRows={visibleDomains}
              visiblePublicAddressRows={visiblePublicAddressRows}
            />
            {portNotice == null ? null : (
              <p className="text-muted-foreground text-sm" role="status">
                {portNotice}
              </p>
            )}
          </>
        ),
        icon: Network,
        id: "public-addresses",
        title: "Public Addresses",
      },
    ],
  };
}
