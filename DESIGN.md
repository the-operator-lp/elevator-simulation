# Elevator Simulator Design System

## 0. Research Log

- Embedded reference: the supplied PDF diagram shows ten numbered floors, three elevator shafts, shared up/down call controls, and highlighted active cars. Keep those relationships in a live DOM grid; the document defines structure, not pixel-perfect website styling.
- UI/UX database: an elevator simulator industrial-control query recommended a restrained slate dashboard and readable status colors. The PDF layout takes precedence over unrelated dashboard patterns.
- Lazyweb screens: skipped because the interview PDF provides the application's only visual reference and this is a small local simulator.
- Imagen drafts: skipped because the PDF supplies the schematic geometry and the brief asks for a simple interface.
- Embedded brand systems: no brand chosen; the diagram is unbranded, so avoid importing branded copy or assets.

## 1. Atmosphere & Identity

A clear control room for observing a small office building. Its signature is the three-shaft floor diagram: car positions and direction calls stay visible together, while each car's destination and door controls sit beside the diagram.

Audience: a candidate demonstrating the simulator to interviewers, plus a keyboard user exercising the controls. The interface stays direct, readable, schematic, and accessible.

## 2. Color Tokens

| Role | Token | Value | Usage |
|---|---|---|---|
| Page | `--color-page` | `#F2F3F4` | Cool neutral canvas |
| Main surface | `--color-surface` | `#FFFFFF` | Building and elevator panels |
| Primary text | `--color-foreground` | `#0F172A` | Headings, floors, labels |
| Secondary text | `--color-muted-foreground` | `#526174` | Supporting information |
| Borders / shaft rules | `--color-border`, `--color-grid` | `#D6DCE3`, `#EDF0F3` | Panel and floor divisions |
| Primary / keyboard focus | `--color-primary`, `--color-focus` | `#334155`, `#245FA8` | Door controls and focus ring |
| Direction call | `--color-direction`, `--color-direction-ink`, `--color-direction-border`, `--color-direction-surface`, `--color-direction-active`, `--color-call-indicator` | `#245FA8`, `#164D84`, `#B7C9DE`, `#F6F9FC`, `#E8F1FA`, `#B8D1E9` | Call buttons and assignments |
| Moving / held | `--color-moving`, `--color-moving-ink`, `--color-moving-surface` | `#8A4B08`, `#7B4308`, `#FFF4E8` | Car and status state |
| Open doors | `--color-open`, `--color-open-ink`, `--color-open-surface`, `--color-open-marker` | `#17633D`, `#145C38`, `#EDF7F0`, `#EFF8F2` | Open and held state |
| Error | `--color-error`, `--color-error-border`, `--color-error-surface` | `#B42318`, `#E3AAA5`, `#FFF3F2` | Connection and command errors |
| Idle / neutral controls | `--color-idle-surface`, `--color-idle-hover` | `#F1F3F5`, `#F4F6F8` | Neutral and hover states |

All color literals live in the root token block in `client/styles.css`; components use semantic tokens. Pair each status color with text or an icon so color never carries meaning alone.

## 3. Typography Tokens

Use the platform sans stack Inter, ui-sans-serif, system-ui, sans-serif; do not fetch a remote font. The root `--font-size-*` tokens cover compact helper text (10–11px), labels (12px), secondary copy (14px), body (16px), section headings (20px), and page titles (25px compact / 28px desktop). `--font-weight-*` tokens control label and heading emphasis. Use tabular numbers for floor values.

## 4. Spacing & Layout Tokens

Spacing uses a 4px base scale with compact half steps: `--space-0-5` through `--space-8` cover 2–32px. Component spacing uses these tokens rather than local literals. `--radius-*`, `--border-width*`, `--height-*`, `--size-*`, and `--layout-*` tokens hold shape, control, marker, and column geometry.

The desktop shell is at most 1280px wide. The main layout places the 10×3 building grid beside a 320px stack of elevator control panels; at desktop widths, both panes share a height and the ten floor rows expand evenly while remaining at least 45px high. Floor order is 10 down to 1. At 980px and below, panels move below the building; at 640px and below, panels stack vertically. At 375px, the three shafts remain readable and controls wrap without horizontal page scrolling.

## 5. Components

### ActionButton

- Structure: semantic button with an arrow icon and a text accessible name.
- Variants: direction, neutral, disabled.
- Spacing: use the shared spacing tokens for icon gaps and button padding.
- States: default, hover, active, visible keyboard focus, disabled.
- Accessibility: native keyboard activation; explicit accessible name; expose `aria-pressed` for active floor calls; disabled controls cannot send commands.
- Motion: short state feedback uses `--duration-feedback`; reduced motion removes interpolation.

### FloorRow

- Structure: semantic list item with floor number, valid shared hall-call buttons, three shaft cells, and car marker.
- Variants: idle, queued request, one or more cars passing.
- Spacing: use the shared spacing tokens for row padding and control gaps.
- States: normal, queued, disabled during connection loss, boundary direction omitted.
- Accessibility: floor number labels the list item; buttons name the floor and direction and expose active state through `aria-pressed`; car status includes ID, floor, and direction in the adjacent panel.
- Motion: the car marker follows server progress; reduced motion disables interpolation.

### ElevatorPanel

- Structure: heading, floor/direction/door status, ten destination buttons, and door controls.
- Variants: idle, moving, doors open, held open, disconnected.
- Spacing: panel padding and status/control gaps use shared spacing tokens.
- States: closed, open, held, disabled destination, offline, command error.
- Accessibility: group is named by elevator ID; destinations are enabled only while doors are open; live errors use `role="alert"`.
- Motion: no layout animation; short state feedback respects reduced motion.

### StatusPill

- Structure: short text label with optional decorative status mark.
- Variants: idle, moving up/down, open, held, connected, disconnected.
- States: status text is self-describing; error status is paired with an alert.
- Accessibility: decorative marks are hidden from assistive technology.
- Motion: none.

## 6. Motion & Interaction

Buttons use a short color/opacity response. Car movement is driven only by backend snapshots and progress; the browser never advances a floor. Do not animate layout dimensions. Under `prefers-reduced-motion: reduce`, remove interpolation and preserve immediate state updates.

## 7. Depth & Surface

Use borders-only surfaces: white panels on the cool neutral page, thin neutral borders dividing floor rows and panels. Do not use gradients, card shadows, or glass effects.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- Target WCAG 2.2 AA, including 4.5:1 contrast for body text, visible keyboard focus, semantic buttons and lists, and operation without a pointer.
- Do not expose invalid up/down controls on floors 10 and 1.
- Disable commands while disconnected and show a textual connection state and actionable validation errors.
- Respect reduced motion; color never carries status alone.

### Accepted Debt

None accepted during implementation. Browser checks verify keyboard and responsive behavior; a real screen-reader session is outside automated evidence and must not be claimed.
