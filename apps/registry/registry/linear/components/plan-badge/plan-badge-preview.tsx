"use client";

import { AppTypeBadge, PlanBadge } from "@workspace/ui/components/plan-badge";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";

const PLAN_NAMES = [
  "Free",
  "Hobby",
  "Starter",
  "Standard",
  "Pro",
  "Plus",
  "Team",
  "Enterprise",
];

const APP_TYPES = ["App Launchpad", "Database", "Object Storage", "DevBox"];

export default function PlanBadgePreview() {
  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview title="Plan tiers">
        <div className="flex flex-wrap items-center gap-3">
          {PLAN_NAMES.map((name) => (
            <PlanBadge key={name} planName={name} />
          ))}
        </div>
      </Preview>

      <Preview title="Unknown plan fallback">
        <div className="flex flex-wrap items-center gap-3">
          <PlanBadge planName="Subscription" />
          <PlanBadge planName="Legacy Metal" />
        </div>
      </Preview>

      <Preview title="App type badge">
        <div className="flex flex-wrap items-center gap-3">
          {APP_TYPES.map((type) => (
            <AppTypeBadge key={type}>{type}</AppTypeBadge>
          ))}
        </div>
      </Preview>
    </PreviewWrapper>
  );
}
