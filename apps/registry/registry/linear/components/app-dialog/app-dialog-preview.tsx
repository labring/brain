"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import { Download, Globe2, Trash2 } from "lucide-react";
import { useState } from "react";

export default function AppDialogPreview() {
  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview title="Confirmation">
        <div className="flex justify-center">
          <AppDialog.Root>
            <AppDialog.Trigger render={<AppButton variant="danger" />}>
              Delete project
            </AppDialog.Trigger>
            <AppDialog.Content>
              <AppDialog.Header>
                <AppDialog.WarningIcon />
                <AppDialog.Title>Delete project?</AppDialog.Title>
              </AppDialog.Header>
              <AppDialog.Body>
                <AppDialog.Description>
                  This will delete{" "}
                  <span className="font-medium text-zinc-100">
                    Analytics warehouse
                  </span>{" "}
                  from the cluster. This cannot be undone.
                </AppDialog.Description>
              </AppDialog.Body>
              <AppDialog.Footer>
                <AppDialog.Cancel>Cancel</AppDialog.Cancel>
                <AppDialog.DestructiveAction>
                  <Trash2 aria-hidden />
                  Delete
                </AppDialog.DestructiveAction>
              </AppDialog.Footer>
            </AppDialog.Content>
          </AppDialog.Root>
        </div>
      </Preview>

      <Preview title="Form">
        <div className="flex justify-center">
          <AppDialog.Root>
            <AppDialog.Trigger render={<AppButton variant="secondary" />}>
              Bind custom domain
            </AppDialog.Trigger>
            <AppDialog.Content>
              <AppDialog.Header>
                <AppDialog.Icon className="text-sky-400">
                  <Globe2 aria-hidden />
                </AppDialog.Icon>
                <AppDialog.Title>Bind Custom Domain</AppDialog.Title>
              </AppDialog.Header>
              <AppDialog.Body>
                <AppDialog.Description>
                  Configure a CNAME record pointing to this Platform Address.
                </AppDialog.Description>
                <AppDialog.Field>
                  <AppDialog.Label>CNAME target</AppDialog.Label>
                  <div className="min-w-0 truncate rounded-md border border-white/10 bg-white/5 px-2.5 py-2 font-mono text-sm text-zinc-100">
                    gateway.demo.sealos.run
                  </div>
                </AppDialog.Field>
                <AppDialog.Field>
                  <AppDialog.Label htmlFor="app-dialog-domain">
                    Custom Domain
                  </AppDialog.Label>
                  <AppDialog.Input
                    id="app-dialog-domain"
                    placeholder="www.example.com"
                  />
                </AppDialog.Field>
              </AppDialog.Body>
              <AppDialog.Footer>
                <AppDialog.Cancel>Cancel</AppDialog.Cancel>
                <AppDialog.Action>Verify</AppDialog.Action>
              </AppDialog.Footer>
            </AppDialog.Content>
          </AppDialog.Root>
        </div>
      </Preview>

      <Preview title="Loading action">
        <LoadingDialogSample />
      </Preview>
    </PreviewWrapper>
  );
}

function LoadingDialogSample() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex justify-center">
      <AppDialog.Root
        onOpenChange={(open) => {
          if (!open) {
            setLoading(false);
          }
        }}
      >
        <AppDialog.Trigger render={<AppButton variant="secondary" />}>
          Export data
        </AppDialog.Trigger>
        <AppDialog.Content>
          <AppDialog.Header>
            <AppDialog.Title>Export table</AppDialog.Title>
          </AppDialog.Header>
          <AppDialog.Body>
            <AppDialog.Description>
              Export the selected table as a downloadable CSV file.
            </AppDialog.Description>
          </AppDialog.Body>
          <AppDialog.Footer>
            <AppDialog.Cancel disabled={loading}>Cancel</AppDialog.Cancel>
            <AppDialog.Action
              loading={loading}
              loadingLabel="Exporting"
              onClick={() => setLoading(true)}
            >
              <Download aria-hidden />
              Export
            </AppDialog.Action>
          </AppDialog.Footer>
        </AppDialog.Content>
      </AppDialog.Root>
    </div>
  );
}
