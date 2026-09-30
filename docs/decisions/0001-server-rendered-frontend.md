# ADR-0001: Server-rendered MPA, no SPA framework

**Status:** Accepted — 2026-09-30 · **Deciders:** Atlas

## Context

ManakAI's hardest non-functional requirements: old phones (320px, low-end Android, older iPhones, older Windows laptops), slow 3G, WCAG AA, fast first meaningful render, and usability when JavaScript fails or loads slowly. The product is mostly reading structured state (checklists, tasks, sources) with two interactive islands (journey chat, task-assist chat).

## Options considered
1. React/Next SPA — rich interactivity, but ~45–90KB+ runtime JS, poor no-JS story, heavier tooling, hydration cost on old devices.
2. Preact/Petite-Vue/Lit islands — lighter, but still framework learning surface and runtime for little gain here.
3. **Server-rendered MPA (Fastify + templates) + vanilla ES modules** — near-zero client JS, complete HTML on first paint, forms work without JS, SEO-friendly, one deployable.

## Decision

Option 3. The app is a multi-page, server-rendered application. JavaScript is a progressive enhancement for: chat islands, checkbox state, toasts, offline banner. Budgets: <40KB JS, <30KB CSS, <20KB HTML (gzipped). No SPA framework, no UI library, no icon package, no web fonts.

## Consequences
- + Works on very old devices by default; no-JS fallback for all core flows.
- + Simple deploy, simple caching, SEO-friendly public pages.
- − Page transitions are full reloads (acceptable: transition to a small fade via CSS only).
- − More template discipline needed (no component framework); mitigated by a strict component/CSS structure in docs/frontend-plan.md.
- If the product later needs heavy realtime collaboration UI, revisit with an islands framework — do not migrate silently.
