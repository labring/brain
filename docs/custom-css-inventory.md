# Custom CSS Inventory

This file lists CSS parameters in this repo that are not Tailwind defaults.
Use it as an allowlist/review map before asking agents to generate UI.

## Scope

- Tailwind default means the tokens/utilities provided by `@import "tailwindcss"` and its default theme, such as `--spacing`, `--color-zinc-*`, `--color-blue-*`, `rounded-*`, `p-*`, and similar scale utilities.
- Project custom means a token, utility class, selector, or hard-coded value defined by this repository, even when it aliases a Tailwind default token.
- This pass covers CSS files and Tailwind theme definitions. TSX arbitrary values such as `bg-[#101219]`, `px-[52px]`, and `ring-[3px]` are separate cleanup targets.

## Global Tailwind Setup

Source: `packages/ui/src/styles/globals.css`

| Lines | Item | Status |
| --- | --- | --- |
| 2 | `tw-animate-css` import | External animation utilities, not Tailwind default. |
| 3 | `shadcn/tailwind.css` import | shadcn/base-mira support layer, not Tailwind default. |
| 4, 8 | `@source` paths | Repo-specific content scanning. Keep. |
| 6 | `@custom-variant dark (&:is(.dark *))` | Project dark-mode variant. Keep. |
| 10-14 | `--scrollbar-width`, `--scrollbar-thumb`, `--scrollbar-track` | Custom theme tokens for global native scrollbars and scrollbar adapters. |

Registry also extends scanning in `apps/registry/src/styles/globals.css` lines 1-4.

## Theme Tokens Exposed To Tailwind

These names create Tailwind utilities like `rounded-4xl`.

| Lines | Tokens | Notes |
| --- | --- | --- |
| 16, 50 | `--font-heading`, `--font-sans` | `--font-heading` is a project alias; `--font-sans` is backed by Next font variable `--font-sans` in app layouts. |
| 17-42 | `--color-sidebar-*`, `--color-ring`, `--color-input`, `--color-border`, `--color-destructive`, `--color-accent-*`, `--color-muted-*`, `--color-secondary-*`, `--color-primary-*`, `--color-popover-*`, `--color-card-*`, `--color-foreground`, `--color-background` | shadcn semantic color layer. Not Tailwind default, but expected for the component system. |
| 43-49 | `--radius-sm` through `--radius-4xl` | Custom radius scale derived from `--radius`, not Tailwind default values. |

## Runtime CSS Variables

Source: `packages/ui/src/styles/globals.css`

| Lines | Tokens | Notes |
| --- | --- | --- |
| 54-80, 92-118 | `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--sidebar-*` | shadcn semantic values for light and dark mode. |
| 72 | `--radius: 0.5rem` | Project base radius. This drives the custom radius scale above. |
| 82-88 | `--color-canvas-surface`, `--color-canvas-glow`, `--color-canvas-dot`, `--canvas-glass-blur-radius` | Canvas-specific runtime tokens. These are project custom even though they reference Tailwind colors. `--canvas-glass-blur-radius` mirrors `CANVAS_GLASS_BLUR_RADIUS` in `canvas-glass-geometry.ts`. |

## Global Custom Utilities

Source: `packages/ui/src/styles/globals.css`

| Lines | Selector | Notes |
| --- | --- | --- |
| 160-185 | base `*`, `body`, `::selection`, native scrollbar pseudos | shadcn-style global base applications plus global native scrollbar styling. |
| 132-144 | `.hoverable` | Project utility for muted hoverable controls. Uses `!bg-input`, so it can override component styles. |
| 347-362 | `.scrollbar-chat-thin` | Legacy explicit marker for chat scroll surfaces. Uses the global scrollbar tokens. |
| 163-170 | `.resource-pane-surface` | SidePane background/overlay utility. Uses literal `#080a11` plus white 4.5% overlay instead of exposing a global resource-pane token. |
| 172-201 | `.main-action-surface-background` and `::after`, `.main-action-surface-body-background` | Custom canvas action background with fixed `132vw` top-biased glow and `1929 / 1255` ratio. The glow is shared by the header and body while the body class remains the content-area hook. Strongly opinionated visual layer. |

## Component CSS Files

These files define selectors and values outside Tailwind utility classes.

| File | Custom values |
| --- | --- |
| `packages/ui/src/components/canvas/canvas.css` | Canvas surface background, React Flow overrides, fixed Figma ratio `1205 / 784`, radial gradient, hidden decorative handles, and the `.canvas-glass-sheet` masked backdrop-filter layer. Keep the sheet a leaf: never move a `filter`/`mask`/`opacity` onto `.canvas-surface` or the viewport, which would become a backdrop root and cut the glow. |
| `packages/ui/src/components/canvas-node/canvas-node.css` | Largest custom block. Defines `--canvas-node-*` dimensions, transitions, color mixes, `0.5px` borders, handle geometry, masks, glow/drag effects, expand-button behavior. This is the main place agents may copy nonstandard styling. |
| `packages/ui/src/components/database-node/database-node.css` | Hidden scrollbars, list max-height formula, empty row min-height. |
| `packages/ui/src/components/container-node/container-node.css` | Custom image-row min-height. |
| `packages/ui/src/components/entry-node/entry-node.css` | Custom target-row/empty min-height. |
| `packages/ui/src/components/environment-node/environment-node.css` | Custom launch-command row min-height. |
| `packages/ui/src/components/project-explorer/project-explorer.css` | Highlight and destructive icon colors for action menu items. |

## Highest-Value Cleanup Targets

1. Keep shadcn semantic tokens, but label them as framework tokens rather than product-specific styling.
2. Put `canvas-node.css` behind a clear "special-case canvas component" boundary so agents do not reuse its hard-coded values elsewhere.
3. Do a second pass over TSX arbitrary values. Several user-facing files contain raw hex colors and bracket values that can affect agent-generated style more than global CSS does.
