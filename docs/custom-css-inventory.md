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
| 10-12 | `--scrollbar-chat-width` | Custom theme token for `.scrollbar-chat-thin`. |

Registry also extends scanning in `apps/registry/src/styles/globals.css` lines 1-4.

## Theme Tokens Exposed To Tailwind

These names create Tailwind utilities like `text-resource-pane-muted`,
`bg-resource-pane-card`, or `rounded-4xl`.

| Lines | Tokens | Notes |
| --- | --- | --- |
| 16, 58 | `--font-heading`, `--font-sans` | `--font-heading` is a project alias; `--font-sans` is backed by Next font variable `--font-sans` in app layouts. |
| 17-42 | `--color-sidebar-*`, `--color-ring`, `--color-input`, `--color-border`, `--color-destructive`, `--color-accent-*`, `--color-muted-*`, `--color-secondary-*`, `--color-primary-*`, `--color-popover-*`, `--color-card-*`, `--color-foreground`, `--color-background` | shadcn semantic color layer. Not Tailwind default, but expected for the component system. |
| 43-50 | `--color-resource-pane-*` | Project-specific dark side-pane / resource-pane palette. Heavily used in project canvas, data browser, and resource settings. |
| 51-57 | `--radius-sm` through `--radius-4xl` | Custom radius scale derived from `--radius`, not Tailwind default values. |

## Runtime CSS Variables

Source: `packages/ui/src/styles/globals.css`

| Lines | Tokens | Notes |
| --- | --- | --- |
| 62-88, 108-133 | `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--sidebar-*` | shadcn semantic values for light and dark mode. |
| 80 | `--radius: 0.5rem` | Project base radius. This drives the custom radius scale above. |
| 90-96 | `--color-canvas-surface`, `--color-canvas-glow`, `--color-canvas-dot` | Canvas-specific runtime tokens. These are project custom even though they reference Tailwind colors. |
| 97-104 | `--resource-pane`, `--resource-pane-overlay`, `--resource-pane-card`, `--resource-pane-border`, `--resource-pane-input`, `--resource-pane-foreground`, `--resource-pane-primary`, `--resource-pane-muted` | Resource-pane palette. Includes raw OKLCH/RGB/hex values. |

## Global Custom Utilities

Source: `packages/ui/src/styles/globals.css`

| Lines | Selector | Notes |
| --- | --- | --- |
| 136-146 | base `*`, `body`, `::selection` | shadcn-style global base applications. |
| 148-160 | `.hoverable` | Project utility for muted hoverable controls. Uses `!bg-input`, so it can override component styles. |
| 163-177 | `.scrollbar-chat-thin` | Custom scrollbar utility. Uses raw scrollbar CSS and `--scrollbar-chat-width`. |
| 179-187 | `.resource-pane-surface` | Project pane background/overlay utility. Used by `SidePane`, canvas action surface, and tests. |
| 189-213 | `.main-action-surface-body-background` and `::after` | Custom canvas action background with fixed `124vw` glow and `1929 / 1255` ratio. Strongly opinionated visual layer. |

## Component CSS Files

These files define selectors and values outside Tailwind utility classes.

| File | Custom values |
| --- | --- |
| `packages/ui/src/components/canvas/canvas.css` | Canvas surface background, React Flow overrides, fixed Figma ratio `1205 / 784`, radial gradient, hidden decorative handles. |
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
