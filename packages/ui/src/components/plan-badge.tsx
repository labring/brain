import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps } from "react";

// The Brain V2.0 tier badge recipe: the tier gradient at 30% alpha as the
// stroke ring, at 12% as the wash behind, and at 100% clipped into the text.
const ENTERPRISE_RECIPE = {
  surface:
    "from-tier-enterprise-from/12 to-tier-enterprise-to/12 before:from-tier-enterprise-from/30 before:to-tier-enterprise-to/30",
  text: "from-tier-enterprise-from to-tier-enterprise-to",
};
const PRO_RECIPE = {
  surface:
    "from-tier-pro-from/12 to-tier-pro-to/12 before:from-tier-pro-from/30 before:to-tier-pro-to/30",
  text: "from-tier-pro-from to-tier-pro-to",
};

/**
 * Catalog names share palette recipes: STANDARD borrows PRO's gradient and
 * PLUS borrows ENTERPRISE's, matching the Brain V2.0 design file.
 */
const PLAN_BADGE_RECIPES: Record<string, { surface: string; text: string }> = {
  ENTERPRISE: ENTERPRISE_RECIPE,
  FREE: {
    surface:
      "from-tier-free-from/12 to-tier-free-to/12 before:from-tier-free-from/30 before:to-tier-free-to/30",
    text: "from-tier-free-from to-tier-free-to",
  },
  HOBBY: {
    surface:
      "from-tier-hobby-from/12 to-tier-hobby-to/12 before:from-tier-hobby-from/30 before:to-tier-hobby-to/30",
    text: "from-tier-hobby-from to-tier-hobby-to",
  },
  PLUS: ENTERPRISE_RECIPE,
  PRO: PRO_RECIPE,
  STANDARD: PRO_RECIPE,
  STARTER: {
    surface:
      "from-tier-starter-from/12 to-tier-starter-to/12 before:from-tier-starter-from/30 before:to-tier-starter-to/30",
    text: "from-tier-starter-from to-tier-starter-to",
  },
  TEAM: {
    surface:
      "from-tier-team-from/12 to-tier-team-to/12 before:from-tier-team-from/30 before:to-tier-team-to/30",
    text: "from-tier-team-from to-tier-team-to",
  },
};

/**
 * Subscription-plan tier badge. Matches the plan name case-insensitively
 * against the tier palette; unknown names keep the same shell with neutral
 * border and foreground text.
 */
function PlanBadge({
  className,
  planName,
  ...props
}: ComponentProps<"span"> & { planName: string }) {
  const recipe = PLAN_BADGE_RECIPES[planName.trim().toUpperCase()];
  // Figma flattens the badge stroke to its first stop when exporting; the
  // actual Brain V2.0 rule is "stroke = the same gradient at 30% alpha", so
  // the ring is a masked ::before (same trick as canvas-node.css).
  return (
    <span
      className={cn(
        "relative inline-flex h-5 w-fit items-center rounded-sm border border-transparent bg-linear-to-r px-1 text-sm",
        "before:pointer-events-none before:absolute before:-inset-px before:rounded-[inherit] before:bg-linear-to-r before:p-px before:content-[''] before:[mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]",
        recipe?.surface ?? "border-border before:hidden",
        className
      )}
      data-slot="plan-badge"
      {...props}
    >
      <span
        className={cn(
          "bg-linear-to-r bg-clip-text font-medium uppercase",
          recipe == null ? "text-foreground" : "text-transparent",
          recipe?.text
        )}
      >
        {planName}
      </span>
    </span>
  );
}

/** The matching app-type badge: a 20px 4px-radius accent rectangle. */
function AppTypeBadge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit items-center rounded-sm bg-accent px-1 font-medium text-accent-foreground text-sm",
        className
      )}
      data-slot="app-type-badge"
      {...props}
    />
  );
}

export { AppTypeBadge, PlanBadge };
