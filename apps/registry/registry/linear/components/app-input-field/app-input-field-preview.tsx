"use client";

import { AppInputField } from "@workspace/ui/components/app-input-field";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";

export default function AppInputFieldPreview() {
  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview title="Default">
        <div className="grid gap-4 md:grid-cols-3">
          <AppInputField
            autoComplete="off"
            id="app-input-field-project"
            label="Project name"
            placeholder="analytics-api"
          />
          <AppInputField
            id="app-input-field-image"
            label="Image"
            placeholder="ghcr.io/seal/app:latest"
          />
          <AppInputField
            id="app-input-field-port"
            inputMode="numeric"
            label="App Listening Port"
            placeholder="3000"
          />
        </div>
      </Preview>

      <Preview title="Guidance">
        <div className="grid gap-4 md:grid-cols-2">
          <AppInputField
            description="Use a stable display name. It can be changed later."
            id="app-input-field-description"
            label="Project name"
            placeholder="analytics-api"
          />
          <AppInputField
            error="Enter a complete public address."
            id="app-input-field-invalid"
            label="Public Address"
            placeholder="https://"
          />
        </div>
      </Preview>

      <Preview title="Product contexts">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-muted/20 p-4">
            <div className="min-w-0">
              <h3 className="font-medium text-foreground text-sm">
                Settings pane
              </h3>
              <p className="text-muted-foreground text-xs leading-5">
                Standard app input spacing for pane forms.
              </p>
            </div>
            <AppInputField
              id="app-input-field-settings-port"
              inputClassName="max-w-32"
              inputMode="numeric"
              label="Target port"
              placeholder="3000"
            />
          </section>

          <section className="dark flex min-w-0 flex-col gap-3 rounded-md border border-white/10 bg-neutral-950 p-4 text-foreground">
            <div className="min-w-0">
              <h3 className="font-medium text-sm text-zinc-50">
                Dark dialog field
              </h3>
              <p className="text-xs text-zinc-400 leading-5">
                Override label and input classes for dense modal surfaces.
              </p>
            </div>
            <AppInputField
              id="app-input-field-domain"
              inputClassName="h-8 border-white/15 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:border-white/25 focus-visible:ring-white/10 dark:bg-transparent"
              label="Custom Domain"
              labelClassName="text-sm text-zinc-200"
              placeholder="www.example.com"
            />
          </section>
        </div>
      </Preview>
    </PreviewWrapper>
  );
}
