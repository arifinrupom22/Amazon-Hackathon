---
name: Warm Editorial Precision
colors:
  surface: '#f7f9ff'
  surface-dim: '#d1dbe9'
  surface-bright: '#f7f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#edf4ff'
  surface-container: '#e4effd'
  surface-container-high: '#dfe9f7'
  surface-container-highest: '#d9e3f1'
  on-surface: '#121c26'
  on-surface-variant: '#3e4947'
  inverse-surface: '#27313c'
  inverse-on-surface: '#e8f2ff'
  outline: '#6e7977'
  outline-variant: '#bdc9c7'
  surface-tint: '#006a64'
  primary: '#00625c'
  on-primary: '#ffffff'
  primary-container: '#177c75'
  on-primary-container: '#c3fff8'
  inverse-primary: '#7ed5cd'
  secondary: '#54615d'
  on-secondary: '#ffffff'
  secondary-container: '#d8e6e1'
  on-secondary-container: '#5a6763'
  tertiary: '#854600'
  on-tertiary: '#ffffff'
  tertiary-container: '#a95b00'
  on-tertiary-container: '#fff1e9'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#9af2e9'
  primary-fixed-dim: '#7ed5cd'
  on-primary-fixed: '#00201e'
  on-primary-fixed-variant: '#00504b'
  secondary-fixed: '#d8e6e1'
  secondary-fixed-dim: '#bccac5'
  on-secondary-fixed: '#121e1b'
  on-secondary-fixed-variant: '#3d4946'
  tertiary-fixed: '#ffdcc3'
  tertiary-fixed-dim: '#ffb77d'
  on-tertiary-fixed: '#2f1500'
  on-tertiary-fixed-variant: '#6e3900'
  background: '#f7f9ff'
  on-background: '#121c26'
  surface-variant: '#d9e3f1'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  label-xs:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

The design system embodies the calculated precision of professional engineering tools tempered by the warmth, intimacy, and hospitality of domestic life. It translates chaotic household operations—schedules, vendor logs, inventories, maintenance budgets, and delegation workflows—into structured, serene clarity.

### Core Philosophy
- **Editorial Tactility over Sterile Dashboarding:** Balances crisp monoline geometry and calculated density with an inviting ivory substrate. The UI avoids the clinical sterility of standard enterprise software while refusing to indulge in frivolous domestic kitsch.
- **Cognitive Decompression:** Household management carries profound emotional fatigue. Interactions must emit definitive, calm reassurance. Information is staged hierarchically so that ambient context remains secondary until activated by the copilot.
- **Utilitarian Elegance:** High-density command surfaces, micro-keyboard accelerators, and clean line iconography harmonize with generous text breathing room and warm, grounded neutral surfaces.

## Colors

The palette grounds high-density productivity in warmth, discarding blue-tinted corporate whites in favor of soft, natural ivory foundations and deep vegetal mineral pigments.

### Roles & Semantic Mapping
- **Canvas Base (`#F7F6F2`):** Warm ivory foundation applied to the global root and viewport backdrop. It creates an organic, paper-like envelope that mitigates digital eye strain.
- **Surface Level 1 (`#FFFFFF`):** Pure white used strictly for primary cards, side panels, conversational feeds, and actionable surfaces.
- **Surface Level 2 (`#FAFAF8`):** Elevated and secondary nesting layer for input wells, data tables, header strips, and inset groupings.
- **Primary Text (`#17212B`):** Deep ink navy, ensuring crisp legibility without the harsh dissonance of pure `#000000`.
- **Secondary / Muted Text (`#707985`):** Slate gray engineered for metadata, table headers, breadcrumb trails, and passive AI context labels. Meets WCAG AA contrast against both white and ivory substrates.
- **Primary Accent (`#177C75`):** Sophisticated deep teal. The signature color for active states, primary callouts, and committed actions. Transitions to `#12635E` on pointer interaction.
- **Accent Soft Substrate (`#E5F3EE`):** Pale mint. Applied as the tint fill for filter chips, tags, badge backplates, and highlighted agent suggestions.
- **Borders & Dividers (`#E6E7E3`):** Neutral hair-line structure. Maintains crisp bounding geometry across all cards and section divides.
- **Feedback Semantics:**
  - **Success (`#15803D`):** Rich emerald green for completed tasks, reconciled expenses, and healthy system status.
  - **Warning (`#D97706`):** Warm amber for pending confirmations, conflicting schedules, and approaching renewals.
  - **Error (`#DC2626`):** Restrained crimson for critical household alerts, failed automations, and overdue payments.

## Typography

Typography prioritizes typographic density, horizontal economy, and rapid optical scanning. Using `Inter` throughout maintains visual cohesion, relying on precise adjustments to optical weight, tabular sizing, and tracking rather than mismatched font pairings.

### Rules of Usage
- **Numerics & Tabular Data:** All monetary amounts, dates, task counts, and timestamps must render with font feature settings enabled: `'tnum' on, 'cv05' on, 'zero' on`.
- **Display Headlines:** Reserved for primary workspace titles, day agendas, and major system modals. Tight negative tracking (`-0.025em`) keeps headlines compact and prevents wrapping in multi-pane layouts.
- **Labels & Micro-Copy:** Small tags, column labels, status pills, and keyboard shortcut legends must use `label-sm` or `label-xs` with uppercase tracking (`0.04em`) to optimize readability at condensed sizes.

## Layout & Spacing

The layout is built upon an 8-point spatial cadence, optimized for high-productivity desktop and laptop screens (principally 1440x900 viewport environments) with support for compact screens.

### Desktop Three-Pane Model (1440x900 Viewport)
1. **Navigation Rail / Household Context (Left):** 240px fixed width. Contains household selector, member presences, and main domain routes.
2. **Copilot & Working Canvas (Center Workspace):** Flexible fluid column (min 560px, max 840px). Hosts the active execution queue, AI chat, schedules, and document workspaces.
3. **Contextual Inspector / Dossier (Right Dock):** 360px fixed width. Houses sub-tasks, telemetry, vendor contacts, and contextual notes. Folds into a slide-over sheet below 1280px width.

### Breakpoints & Adaptations
- **Desktop (>= 1280px):** Full three-pane view. Margins set to `margin-desktop` (32px), gutters set to `gutter-desktop` (24px).
- **Tablet / Small Laptop (768px - 1279px):** Two-pane view. Contextual Inspector converts into an overlay drawer. Navigation rail collapses to a 64px icon-only rail.
- **Mobile (< 768px):** Single-pane linear stack. Navigation transforms into an app bar and bottom sheet. Padding scales down to `margin` (16px).

## Elevation & Depth

Depth is established primarily through structural boundaries and low-contrast surface stratification, supplemented by ultra-subtle, ambient shadow drops. Blurs and heavy 3D skeuomorphism are rejected in favor of razor-sharp hairline borders.

### Spatial Tiers
- **Tier 0 (Root Base):** Background Ivory (`#F7F6F2`). Zero shadow, entirely planar.
- **Tier 1 (Surface Canvas):** Pure White (`#FFFFFF`) with a 1px solid `#E6E7E3` hairline stroke and ambient drop `0 1px 3px rgba(23, 33, 43, 0.04)`. Used for content cards, kanban stacks, and feed messages.
- **Tier 2 (Interactive Floating / Hover):** `#FFFFFF` with a 1px solid `#E6E7E3` stroke and elevation `0 4px 12px rgba(23, 33, 43, 0.03), 0 1px 2px rgba(23, 33, 43, 0.06)`. Applied to active popovers, floating input prompts, and context flyouts.
- **Tier 3 (Modals & Overlays):** `#FFFFFF` bordered with `#E6E7E3`, backed by a warm tinted scrim (`rgba(23, 33, 43, 0.2)`), elevated with `0 12px 32px rgba(23, 33, 43, 0.08)`.

## Shapes

The geometric architecture balances soft comfort with crisp, modular utility. Border radii are structured systematically based on container scale:

- **12px (`rounded-lg`):** Main content cards, dialog containers, split pane wrappers, and parent AI prompt cards.
- **8px (`rounded-md`):** Buttons, interactive cards, table row groupings, and form input frames.
- **6px (`rounded-sm`):** Filter chips, action badges, keyboard shortcut badges, and notification tags.
- **Full Pill (`9999px`):** User avatars, active agent presence indicators, and status indicator dots only.

## Components

### Buttons
- **Primary Button:** Background `#177C75`, text `#FFFFFF`, border `1px solid transparent`, radius `8px`. Hover: `#12635E`. Active: `#0D4E4A`. Focus: 2px ring `#177C75` offset by 2px `#F7F6F2`.
- **Secondary / Subdued:** Background `#FFFFFF`, text `#17212B`, border `1px solid #E6E7E3`, radius `8px`. Hover: background `#FAFAF8`, border `#D4D6D0`.
- **Ghost:** Background transparent, text `#707985`, radius `8px`. Hover: background `#E5F3EE`, text `#177C75`.

### Chips & Badges
- **Status Chips:** Height 24px, radius 6px, horizontal padding 8px. Typography `label-sm`.
- **Subtle Accent Chip (Household AI Tag):** Background `#E5F3EE`, text `#177C75`, border `1px solid rgba(23, 124, 117, 0.15)`.
- **Warning Chip:** Background `#FEF3C7`, text `#D97706`, border `1px solid rgba(217, 119, 6, 0.2)`.

### Lists & Data Records
- Rows utilize 40px compact heights with 1px border bottoms (`#E6E7E3`).
- Hover triggers subtle surface shift to `#FAFAF8`.
- Action triggers within rows remain hidden until hover, minimizing visual noise.

### Form Inputs & Prompts
- Default height 36px (or multi-line auto-grow for copilot prompt).
- Background `#FFFFFF`, border `1px solid #E6E7E3`, radius `8px`, text `#17212B`, placeholder `#707985`.
- Focus state: border color `#177C75`, box shadow `0 0 0 1px #177C75`.
- Inner AI Copilot Bar: Inset action badges (e.g., `Cmd + K`, `Return to delegate`) styled with `label-xs` on `#FAFAF8` with 1px solid border.

### Checkboxes & Radios
- Size: 16px x 16px. Radius: 4px for checkboxes, full circle for radios.
- Unchecked: 1.5px border `#707985`, background `#FFFFFF`.
- Checked: Background `#177C75`, border `#177C75`, inner checkmark `#FFFFFF`.

### Cards & Inset Modules
- Container: `#FFFFFF` fill with `1px solid #E6E7E3`, corner radius 12px.
- Internal header separation: 1px divider `#E6E7E3` with 12px top/bottom padding and 16px horizontal inset.
- Inner nested modules (e.g., AI rationale box, automation trigger card): Background `#FAFAF8`, radius 8px, padding 12px.