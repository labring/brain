"use client";

import {
  AppMultiSelect,
  AppSelect,
  type AppSelectOption,
} from "@workspace/ui/components/app-select";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import {
  Blocks,
  Box,
  Cpu,
  Database,
  Globe2,
  HardDrive,
  Server,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

const appOptions = [
  {
    value: "api",
    label: "API service",
    icon: <Server />,
  },
  {
    value: "worker",
    label: "Background worker",
    icon: <Cpu />,
  },
  {
    value: "postgres",
    label: "Postgres database",
    icon: <Database />,
  },
  {
    value: "gateway",
    label: "Public gateway",
    icon: <Globe2 />,
  },
] satisfies readonly AppSelectOption[];

const resourceOptions = [
  {
    value: "containers",
    label: "Containers",
    icon: <Box />,
  },
  {
    value: "volumes",
    label: "Volumes",
    icon: <HardDrive />,
  },
  {
    value: "network",
    label: "Network",
    icon: <Globe2 />,
  },
  {
    value: "secrets",
    label: "Secrets",
    icon: <ShieldCheck />,
  },
  {
    value: "dependencies",
    label: "Dependencies",
    icon: <Blocks />,
  },
] satisfies readonly AppSelectOption[];

export default function AppSelectPreview() {
  const [appValue, setAppValue] = useState("api");
  const [searchableValue, setSearchableValue] = useState("postgres");
  const [resourceValue, setResourceValue] = useState<string[]>([
    "containers",
    "network",
  ]);

  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview title="Single select">
        <div className="grid gap-4 md:grid-cols-3">
          <AppSelect
            aria-label="Select app"
            onValueChange={setAppValue}
            options={appOptions}
            value={appValue}
          />
          <AppSelect
            aria-label="Select database"
            onValueChange={setSearchableValue}
            options={appOptions}
            searchable
            searchPlaceholder="Search resources"
            value={searchableValue}
          />
          <AppSelect
            aria-label="Select disabled app"
            disabled
            options={appOptions}
            value="worker"
          />
        </div>
      </Preview>

      <Preview title="Multi select">
        <div className="grid gap-4 md:grid-cols-2">
          <AppMultiSelect
            allLabel="All resources"
            aria-label="Filter resources"
            icon={<Box />}
            onValueChange={setResourceValue}
            options={resourceOptions}
            placeholder="Filter resources"
            value={resourceValue}
          />
          <AppMultiSelect
            allLabel="All"
            aria-label="Empty multi select"
            emptyMessage="No resources available."
            options={[]}
            value={[]}
          />
        </div>
      </Preview>

      <Preview title="Product contexts">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-muted/20 p-4">
            <div className="min-w-0">
              <h3 className="font-medium text-foreground text-sm">
                Deploy form
              </h3>
              <p className="text-muted-foreground text-xs leading-5">
                Search keeps larger option sets quick to scan.
              </p>
            </div>
            <AppSelect
              aria-label="Select deployment target"
              options={appOptions}
              placeholder="Select target"
              searchable
              value="gateway"
            />
          </section>

          <section className="dark flex min-w-0 flex-col gap-3 rounded-md border border-white/10 bg-neutral-950 p-4 text-foreground">
            <div className="min-w-0">
              <h3 className="font-medium text-sm text-zinc-50">Logs toolbar</h3>
              <p className="text-xs text-zinc-400 leading-5">
                Multi-select summarizes repeated filters in a compact trigger.
              </p>
            </div>
            <AppMultiSelect
              allLabel="All streams"
              aria-label="Filter log streams"
              icon={<Server />}
              options={resourceOptions}
              triggerClassName="border-white/15 bg-transparent text-zinc-100 hover:bg-white/10 data-[popup-open]:border-white/25 data-[popup-open]:ring-white/10"
              value={["containers", "dependencies", "secrets"]}
            />
          </section>
        </div>
      </Preview>
    </PreviewWrapper>
  );
}
