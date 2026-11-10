---
name: NetMonitor Design System
description: Precision network monitoring and topology operations console
colors:
  # Light Theme Primitives (Soft Slate / Anti-Glare for NOC consoles)
  light-bg-canvas: "#e8edf2"
  light-bg-surface: "#f6f8fa"
  light-bg-elevated: "#dde3ea"
  light-border-subtle: "#d4dce6"
  light-border-default: "#bdc8d6"
  light-text-primary: "#1e293b"
  light-text-secondary: "#475569"
  light-text-muted: "#57657a"
  light-accent-primary: "#2563eb"
  light-accent-hover: "#1d4ed8"

  # Dark Theme Primitives
  dark-bg-canvas: "#0b0f19"
  dark-bg-surface: "#111827"
  dark-bg-elevated: "#1e293b"
  dark-border-subtle: "#1f2937"
  dark-border-default: "#374151"
  dark-text-primary: "#f9fafb"
  dark-text-secondary: "#cbd5e1"
  dark-text-muted: "#94a3b8"
  dark-accent-primary: "#3b82f6"
  dark-accent-hover: "#60a5fa"

  # Shared Semantic Status
  status-online: "#10b981"
  status-warning: "#f59e0b"
  status-critical: "#ef4444"
  status-unmanaged: "#64748b"

typography:
  fontFamily: "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif"
  fontMono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace"
  fontSize-xs: "12px"
  fontSize-sm: "13px"
  fontSize-base: "14px"
  fontSize-md: "16px"
  fontSize-lg: "18px"
  fontSize-xl: "20px"
  fontSize-2xl: "24px"

rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "9999px"

spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
---

# NetMonitor Design System

## Overview
NetMonitor operates in **Operate Mode** — a dense, high-utility network observation deck. The design must minimize cognitive overhead, emphasize live device health and bandwidth throughput, and deliver pristine contrast in both daylight and dark control room environments.

## Colors & Themes

NetMonitor uses CSS variables on the root document element `data-theme="dark"` (default) and `data-theme="light"`:

```css
:root, [data-theme="dark"] {
  --bg-canvas: #0b0f19;
  --bg-surface: #111827;
  --bg-elevated: #1e293b;
  --bg-subtle: #162032;
  --border-subtle: #1f2937;
  --border-default: #374151;
  --border-hover: #4b5563;
  --text-primary: #f9fafb;
  --text-secondary: #cbd5e1;
  --text-muted: #94a3b8;
  --accent-primary: #3b82f6;
  --accent-subtle: rgba(59, 130, 246, 0.15);
  --accent-hover: #60a5fa;
  --status-online: #10b981;
  --status-warning: #f59e0b;
  --status-critical: #ef4444;
  --status-unmanaged: #64748b;
  --chart-inbound: #38bdf8;
  --chart-outbound: #818cf8;
}

[data-theme="light"] {
  --bg-canvas: #e8edf2;
  --bg-surface: #f6f8fa;
  --bg-elevated: #dde3ea;
  --bg-subtle: #d0d8e2;
  --border-subtle: #d4dce6;
  --border-default: #bdc8d6;
  --border-hover: #8f9eb2;
  --text-primary: #1e293b;
  --text-secondary: #475569;
  --text-muted: #57657a;
  --accent-primary: #2563eb;
  --accent-subtle: rgba(37, 99, 235, 0.08);
  --accent-hover: #1d4ed8;
  --status-online: #047857;
  --status-warning: #b45309;
  --status-critical: #dc2626;
  --status-unmanaged: #64748b;
  --chart-inbound: #0284c7;
  --chart-outbound: #6366f1;
}
```

## Typography
- **UI Font:** `Inter`, `Segoe UI`, `system-ui`, sans-serif.
- **Numbers / Metrics:** Always use tabular numerals (`font-variant-numeric: tabular-nums`) for bandwidth metrics, packet rates, and IP addresses to prevent visual jitter during live updates.
- **Micro-type Floor:** Strictly keep 12px as the absolute minimum font size. Avoid sub-12px microtext (`10px` / `10.5px`).

## Layout
- **Fixed Top Navbar (56px):** Compact, brand-elevated bar with clear active page indicators, global search trigger, language switch, theme toggle, and live simulation pause/resume.
- **Split Workspace:** Floorplan canvas with zoom controls on the left, sticky diagnostic sidebar with search filter, device category tabs, and active device pins on the right.
- **Collapsible Diagnostic Inspector:** Sliding detail drawer / modal displaying live SNMP charts, interface tables, and quick action toolbars.

## Elevation & Depth
- **Borders & Shadows:** Clean 1px solid borders (`var(--border-subtle)` / `var(--border-default)`) combined with subtle, crisp box-shadows (`0 1px 3px 0 rgba(0,0,0,0.1)`) instead of flat murky fills.
- **No Side-Tabs:** Avoid thick 3px-4px unilateral left borders on cards/toasts; use subtle badge pills and soft background tints instead.

## Shapes
- **Corner Radius:** 6px for buttons/inputs, 8px for cards and dropdowns, 12px for modals.
- **Pills:** Full rounded (9999px) exclusively for status badges (`● LIVE`, `ONLINE`).

## Components
- **Navbar:** Sticky top bar with logo, tab links, quick search pill, theme toggle icon button, language switch, and live status toggle.
- **Traffic Chart:** Real-time dual SVG line/area curves with gradient fills, crosshair tooltips, time-range pill tabs (15m, 1h, 6h, 24h, 7d), and port selector dropdown.
- **Device Pin:** High-visibility pulsing status rings on floorplan canvas.
- **Action Buttons:** Clearly categorized primary (brand blue), secondary (surface outline), and destructive (soft red outline).

## Do's and Don'ts
- **DO** use CSS semantic variables everywhere (`var(--bg-surface)`, `var(--text-primary)`).
- **DO** support instant theme switching without page reload.
- **DO** ensure high contrast ratios (minimum 4.5:1 for body text, 3:1 for large headers and status badges).
- **DON'T** hardcode dark hex colors (`#0f1117`, `#1a202c`, `#161b27`) in CSS modules.
- **DON'T** use fonts smaller than 12px.
- **DON'T** use decorative AI-slop side borders or low-contrast muddy grays.
