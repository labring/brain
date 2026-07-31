"use client";

import { ResourceSettingsSection } from "@workspace/ui/components/resource-settings/resource-settings";
import { SidePaneFooter } from "@workspace/ui/components/side-pane";
import type { SettingsViewModel } from "./settings-types";

export function SettingsSections({ model }: { model: SettingsViewModel }) {
  return (
    <div
      className="flex w-full flex-col gap-5 text-muted-foreground"
      data-settings-view={model.resolvedView}
      data-slot="settings-host-sections"
    >
      {model.sections.map((section) =>
        section.chromeless ? (
          <div data-settings-section={section.id} key={section.id}>
            {section.content}
          </div>
        ) : (
          <ResourceSettingsSection
            actions={section.actions}
            data-settings-section={section.id}
            icon={section.icon}
            key={section.id}
            title={section.title}
          >
            {section.content}
          </ResourceSettingsSection>
        )
      )}
      {model.footer == null ? null : (
        <SidePaneFooter>{model.footer}</SidePaneFooter>
      )}
    </div>
  );
}
