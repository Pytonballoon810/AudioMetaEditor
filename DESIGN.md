# DESIGN.md

Design system reference for AudioMetaEditor. This document captures visual philosophy, core tokens, and implementation specifications so UI work stays coherent across features.

Companion operations guide: `AGENTS.md`.

## Design Philosophy

AudioMetaEditor follows a focused desktop-studio aesthetic:

- Dark, layered surfaces prioritize waveform and metadata readability.
- High-contrast text and controls support long editing sessions.
- Accent colors are expressive, but functional status colors remain distinct.
- Motion is short and informative, used for state change clarity (hover/focus/loading), not decoration.
- Panels and controls use rounded geometry and soft translucency to separate interactive zones.

## Source Of Truth

- Primary visual tokens: `src/styles.css` (`:root` custom properties)
- Desktop window chrome colors: `electron/main.js` (`titleBarOverlay`, `backgroundColor`)

When there is a mismatch between this document and implementation, code is the source of truth until this file is updated.

## Core Color Tokens

Defined in `src/styles.css`.

| Token | Value | Purpose |
| --- | --- | --- |
| `--bg` | `#101416` | Primary background anchor tone |
| `--panel` | `rgba(17, 23, 29, 0.78)` | Glass panel surface |
| `--panel-strong` | `#182028` | Elevated dark surface |
| `--panel-soft` | `#22303c` | Secondary soft surface |
| `--line` | `rgba(255, 255, 255, 0.08)` | Borders and separators |
| `--text` | `#eef4f3` | Primary foreground text |
| `--muted` | `#9eb2b1` | Secondary/support text |
| `--accent` | `#ff5ea8` | Primary action and highlights |
| `--accent-strong` | `#ff9ccd` | Accent text/details |
| `--cool` | `#75c9ff` | Secondary accent and progress cues |

## Supporting UI Colors

Used repeatedly for semantic states and control variants:

- Background gradient anchors: `#0d1013`, `#14191d`, `#101416`
- Primary button gradient pair: `#ff5ea8` to `#ff89c2`
- Secondary accent button pair: `#65d6ce` to `#75c9ff`
- Warning tone: `#ffc47f` (library warning icon, mismatch indicators)
- Error tone: `#ffd1d1` with deep red background tint (`rgba(66, 22, 22, 0.45)`)
- Save/success control family: green-tinted gradients around `rgba(38, 76, 61, 0.9)` to `rgba(35, 66, 54, 0.98)`

## Native Window Colors

Defined in `electron/main.js`:

- Windows title bar overlay background: `#101416`
- Windows title bar symbols: `#eef4f3`
- BrowserWindow fallback background: `#121417`

These must stay visually aligned with renderer dark surfaces.

## Typography

- App base font: `'Space Grotesk', 'Segoe UI', sans-serif`
- Display/headings: `'Sora', 'Space Grotesk', sans-serif`
- Letter spacing style:
	- Headings: slightly condensed (`-0.03em`)
	- Eyebrow labels: expanded uppercase (`0.16em`)

Guidelines:

- Keep dense metadata controls in base font for readability.
- Reserve heading font for top-level hierarchy only.

## Shape, Depth, And Surfaces

- Major panel radius: `28px`
- Secondary containers/cards: `14px` to `20px`
- Pill/button style: fully rounded (`999px`) for primary actions
- Surface depth uses soft blur and shadow (`--shadow`: `0 28px 80px rgba(0, 0, 0, 0.35)`)

Guidelines:

- Prefer tokenized borders (`--line`) over hard opaque borders.
- Keep translucent dark panels to preserve visual continuity across panes.

## Layout Specifications

Current desktop grid pattern:

- 3-column shell with draggable separators:
	- Library pane
	- Main pane (player + status split)
	- Metadata pane
- Resizer rails are 12px and use accent/cool gradients for affordance.

Runtime width/height constraints (from `src/App.tsx`):

- Metadata width: min `320`, max `760`, default `400`
- Status bar height: min `56`, max `280`, default `92`
- Player minimum height: `260`

Responsive behavior:

- <= `1280px`: metadata pane moves below main content.
- <= `860px`: single-column stack; resizer rails hidden.

## Motion And Interaction

- Standard transition duration: `120ms`
- Secondary popover/fade timing: `140ms`
- Spinner animation: continuous `0.8s` linear rotation
- Hover affordance: slight translate (`-1px`) and border/background emphasis

Guidelines:

- Keep animations short and state-focused.
- Do not introduce long easing chains for core editing actions.

## Component Behavior Specs

- Focus rings use accent/cool tinted outlines; do not remove visible keyboard focus styles.
- Dropdowns/popovers use dark translucent backgrounds with subtle blur.
- Warning and error states must stay visually distinct from accent branding colors.
- Cover editing tools should preserve visible active state (`wand-active`, highlighted tool state).

## Change Management

Any PR that changes visual tokens, semantic colors, typography stack, major spacing/radius conventions, or responsive breakpoints must update this file.

Coordination rule:

- If architecture/workflow boundaries are also affected, update both `DESIGN.md` and `AGENTS.md` in the same PR.
