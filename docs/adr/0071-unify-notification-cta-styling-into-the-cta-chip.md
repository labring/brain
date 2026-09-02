# Unify notification CTA styling into the CTA Chip

Every notification surface grew its own CTA dress: the billing callout family wore the brand-primary button, the chat billing error card the neutral secondary, the Status Hint and the Notification Center hand-rolled a current-color chip twice at two different heights (h-7 and h-6), and a toast action fell through to sonner's native near-white button. Four competing variants for the same role — "the one fix this notification offers" — two color models (current-color chip vs fixed palette), and no shared definition anywhere: the earlier content unification (quota CTA wording, real top-up destinations, ADR-0070's fixed notice CTAs) left styling as the missing half. A comparison prototype (baseline plus five recipes, in Paper and Figma) settled the visual question; this record fixes the outcome.

## Decision

**One recipe, one source: the CTA Chip.** The notification CTA is a chip — the small button structure (28px, radius 8, 12px medium) washed in `currentColor` at 15%, 25% on hover — defined exactly once, as the shared app button's `chip` variant, with `chip-quiet` (transparent at rest, 15% on hover) as the optional second way out beside it. Surfaces stop restating the recipe in local class overrides.

**Color derives from tone, never from the chip.** The chip takes `currentColor`; the host surface sets the tone text color (the billing-surface-tones / severity vocabulary: destructive red, amber warning, blue info). Severity stays marked, not shouted (CONTEXT.md, Notification Severity): the card body remains neutral, the tone lives on icon and chip alone. The brand-primary button leaves the notification role entirely — a notification CTA is a severity-colored fix, not a brand action.

**The tier is fixed.** A notification renders at most one chip, an optional `chip-quiet` sibling, and a dismiss. A surface whose CTA is today secondary-styled but is the card's only way out (the chat billing error card) is a chip — primacy follows role, not previous dress.

**Every in-scope surface migrates at once.** Billing callout family (deploy billing notice, deployment billing interruption, chat paid wall and billing error cards), Status Hint banner, Notification Center cards (h-6 grows to the shared 28px), and the toast action button. The toast restates the chip's properties with `!important` in the shared Toaster — sonner's stylesheet is unlayered and would beat layered utilities — and its per-type rows feed the chip's tone; the stray warning yellow joins the amber warning vocabulary in the same move. Out of scope stay the surfaces that are not notifications: the sidebar Upgrade link, the debt caption, inline error strips, and the neutral Free Chat Turns counter's quiet link.

**CTA content is untouched.** What a CTA says and where it goes remain governed by ADR-0067 (the CTA is data, server-substitutable), ADR-0068 (the judged cause dictates the CTA), and ADR-0070 (the notice's CTAs are fixed). Only the dress changes.

## Considered Options

- **Solid tone-colored buttons.** Rejected: a solid red button shouts — it breaks the marked-not-shouted rule the Notification Center is built on and reads as a destructive action, not a fix.
- **Chip plus a tone border.** Rejected: the border restates what the wash already says and adds weight without adding hierarchy; the plain chip won the side-by-side.
- **Brand-primary chip or solid (severity leaves the CTA).** Rejected: it re-splits the color model the unification exists to close — severity would live on the icon but not the CTA, and every notification would gain a brand-blue accent regardless of urgency.
- **A new wrapper component instead of a button variant.** Rejected: the recipe is pure style with no product workflow, so a variant on the existing shared button is the smallest single source; the billing-aware link wrappers (resolution, return routes) already exist per surface and simply adopt it.

## Consequences

- The chip recipe has one definition (`app-button`'s `chip` / `chip-quiet`); the Status Hint and Notification Center delete their hand-rolled copies, and the Notification Center chip grows from 24px to the shared 28px.
- The billing callout family's primary CTA loses the brand-primary look and picks up the card's tone; the chat billing error card's CTA is promoted from secondary dress to the chip its role warrants.
- Toast actions stop looking native-sonner; the toast warning icon moves from yellow-400 to amber-400, closing the last tone-vocabulary stray on an in-scope surface.
- CONTEXT.md gains the CTA Chip entry under Design System; the comparison prototype (Paper file "Hearty unity", Figma file "PROTOTYPE · 通知 CTA 视觉配方对比") is throwaway and holds no authority once this record lands.
