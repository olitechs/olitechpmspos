# OliTechs PMS + POS — UI/UX Pro Max Design System

## Product
Hotel property management system + point of sale for front office, F&B, housekeeping, inventory, and management teams.

## Design intent
Professional hospitality operations console: fast to scan, dense without feeling cramped, calm under pressure, and optimized for desktop/tablet workflows.

## Layout
Use a persistent navigation rail, compact context bar, 12-column content grid, sticky table headers where useful, and progressive disclosure for secondary actions.

## Visual style
Premium minimalism with restrained hospitality character. Use crisp surfaces, 1px borders, shallow shadows, strong black/charcoal navigation, and yellow for primary actions, selected states, attention, and brand moments.

Avoid glassmorphism, decorative gradients, oversized hero cards, excessive pills, and hover-only critical actions.

## Brand

Charcoal / near-black #0B0F14 and #1F252D
Brand Yellow #FFC400 (primary actions use dark text #0B0F14)
Action Hover #E6B000
Brand Soft #FFF4C2
App Background #F6F7F9
Surface #FFFFFF
Secondary Surface #F1F3F6
Border #E2E6EB
Strong Border #C5CCD5
Primary Text #0F1720
Secondary Text #5B6677
Info / Focus #2563EB
Success #059669
Warning #D97706
Destructive #DC2626

This approved palette supersedes the previous blue/slate palette proposal. CSS variables in `src/index.css` are the single source of truth; do not introduce duplicate hard-coded palette systems. Use dark text on yellow actions, never white. Status must include a label and/or icon as well as color.

## Typography
System sans for UI. Page titles 20–24px. Section titles 13–15px. Body 14–15px. Operational labels 11–12px. Metrics 20–28px with tabular/monospace numerals.

## Accessibility
Status must never rely on color alone. Maintain visible focus states, keyboard access, readable contrast, and reduced-motion support.

## Hospitality hierarchy
1. Operational status
2. Arrivals, departures, in-house guests and room status
3. Revenue, cashier and folio exceptions
4. Department queues
5. Detailed records and configuration
