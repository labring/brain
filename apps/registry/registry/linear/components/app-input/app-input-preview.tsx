"use client";

import { AppInput } from "@workspace/ui/components/app-input";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import { Search } from "lucide-react";

const fields = [
  {
    id: "app-input-project",
    label: "Project name",
    placeholder: "analytics-api",
    value: "",
  },
  {
    id: "app-input-image",
    label: "Image",
    placeholder: "ghcr.io/seal/app:latest",
    value: "",
  },
  {
    id: "app-input-port",
    label: "App Listening Port",
    placeholder: "3000",
    value: "",
  },
] as const;

export default function AppInputPreview() {
  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview title="Default">
        <div className="grid gap-4 md:grid-cols-3">
          {fields.map(({ id, label, placeholder, value }) => (
            <label
              className="flex min-w-0 flex-col gap-2"
              htmlFor={id}
              key={id}
            >
              <span className="font-medium text-foreground text-sm">
                {label}
              </span>
              <AppInput
                autoComplete="off"
                defaultValue={value}
                id={id}
                placeholder={placeholder}
              />
            </label>
          ))}
        </div>
      </Preview>

      <Preview title="Variants">
        <div className="grid gap-4 md:grid-cols-2">
          <label
            className="flex min-w-0 flex-col gap-2"
            htmlFor="app-input-default"
          >
            <span className="font-medium text-foreground text-sm">Default</span>
            <AppInput id="app-input-default" placeholder="www.example.com" />
          </label>

          <label
            className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-background px-3 py-2"
            htmlFor="app-input-bare"
          >
            <span className="font-medium text-foreground text-sm">
              Bare in framed row
            </span>
            <AppInput
              defaultValue="gateway.demo.sealos.run"
              id="app-input-bare"
              variant="bare"
            />
          </label>
        </div>
      </Preview>

      <Preview title="States">
        <div className="grid gap-4 md:grid-cols-3">
          <label
            className="flex min-w-0 flex-col gap-2"
            htmlFor="app-input-filled"
          >
            <span className="font-medium text-foreground text-sm">Filled</span>
            <AppInput
              defaultValue="postgres://main"
              id="app-input-filled"
              readOnly
            />
          </label>

          <label
            className="flex min-w-0 flex-col gap-2"
            htmlFor="app-input-invalid"
          >
            <span className="font-medium text-foreground text-sm">Invalid</span>
            <AppInput
              aria-invalid="true"
              defaultValue="https://"
              id="app-input-invalid"
            />
            <span className="text-destructive text-xs">
              Enter a complete public address.
            </span>
          </label>

          <label
            className="flex min-w-0 flex-col gap-2"
            htmlFor="app-input-disabled"
          >
            <span className="font-medium text-foreground text-sm">
              Disabled
            </span>
            <AppInput
              defaultValue="Waiting for allocation"
              disabled
              id="app-input-disabled"
            />
          </label>
        </div>
      </Preview>

      <Preview title="Product contexts">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-muted/20 p-4">
            <div className="min-w-0">
              <h3 className="font-medium text-foreground text-sm">
                Search field
              </h3>
              <p className="text-muted-foreground text-xs leading-5">
                Icon padding keeps query text aligned in list filters.
              </p>
            </div>
            <div className="relative min-w-0">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <AppInput
                aria-label="Search resources"
                className="pl-9"
                placeholder="Search resources..."
                type="search"
              />
            </div>
          </section>

          <section className="dark flex min-w-0 flex-col gap-3 rounded-md border border-white/10 bg-neutral-950 p-4 text-foreground">
            <div className="min-w-0">
              <h3 className="font-medium text-sm text-zinc-50">
                Dark dialog field
              </h3>
              <p className="text-xs text-zinc-400 leading-5">
                The base input stays neutral when composed into dark surfaces.
              </p>
            </div>
            <label
              className="flex min-w-0 flex-col gap-2"
              htmlFor="app-input-domain"
            >
              <span className="font-medium text-sm text-zinc-200">
                Custom Domain
              </span>
              <AppInput
                className="h-8 border-white/15 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:border-white/25 focus-visible:ring-white/10 dark:bg-transparent"
                id="app-input-domain"
                placeholder="www.example.com"
              />
            </label>
          </section>
        </div>
      </Preview>
    </PreviewWrapper>
  );
}
