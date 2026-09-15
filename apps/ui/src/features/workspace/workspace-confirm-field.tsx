"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";

/**
 * The typed confirmation the destructive Workspace actions share (spec
 * §D.7): delete and transfer go through only once the Workspace's name is
 * typed back exactly.
 */
export function WorkspaceNameConfirmField({
  name,
  onChange,
  value,
}: {
  name: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <AppDialog.Field>
      <p className="select-text text-sm/5 text-zinc-400">
        Type <span className="font-mono text-zinc-100">{name}</span> to confirm.
      </p>
      <AppDialog.Input
        aria-label={`Type ${name} to confirm.`}
        autoComplete="off"
        className="font-mono"
        onChange={(event) => onChange(event.target.value)}
        placeholder={name}
        type="text"
        value={value}
      />
    </AppDialog.Field>
  );
}

export function nameConfirmed(value: string, name: string): boolean {
  return value === name;
}
