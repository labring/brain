"use client";

import { AppTextarea } from "@workspace/ui/components/app-textarea";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";

export default function AppTextareaPreview() {
  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview title="Default">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5" htmlFor="app-textarea-description">
            <span className="font-medium text-foreground text-sm">
              Description
            </span>
            <AppTextarea
              id="app-textarea-description"
              placeholder="Describe what this service does..."
            />
          </label>

          <label className="grid gap-1.5" htmlFor="app-textarea-command">
            <span className="font-medium text-foreground text-sm">
              Launch command
            </span>
            <AppTextarea
              defaultValue={"bun install\nbun run start"}
              id="app-textarea-command"
              spellCheck={false}
            />
          </label>
        </div>
      </Preview>

      <Preview title="States">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid gap-1.5" htmlFor="app-textarea-filled">
            <span className="font-medium text-foreground text-sm">Filled</span>
            <AppTextarea
              defaultValue="DATABASE_URL=postgres://..."
              id="app-textarea-filled"
              readOnly
              spellCheck={false}
            />
          </label>

          <label className="grid gap-1.5" htmlFor="app-textarea-invalid">
            <span className="font-medium text-foreground text-sm">Invalid</span>
            <AppTextarea
              aria-invalid
              defaultValue="PORT="
              id="app-textarea-invalid"
              spellCheck={false}
            />
          </label>

          <label className="grid gap-1.5" htmlFor="app-textarea-disabled">
            <span className="font-medium text-foreground text-sm">
              Disabled
            </span>
            <AppTextarea
              disabled
              id="app-textarea-disabled"
              placeholder="Waiting for selection"
            />
          </label>
        </div>
      </Preview>

      <Preview title="Product context">
        <section className="dark flex min-w-0 flex-col gap-3 rounded-md border border-white/10 bg-neutral-950 p-4 text-foreground">
          <div className="min-w-0">
            <h3 className="font-medium text-sm text-zinc-50">
              Environment source
            </h3>
            <p className="text-xs text-zinc-400 leading-5">
              Multi-line values keep the same product focus treatment as App
              Input.
            </p>
          </div>
          <AppTextarea
            defaultValue={"NODE_ENV=production\nLOG_LEVEL=info"}
            spellCheck={false}
          />
        </section>
      </Preview>
    </PreviewWrapper>
  );
}
