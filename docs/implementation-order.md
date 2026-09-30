# ManakAI — Implementation Order

Phased plan. Each phase ends with a QA gate (Sentinel) and merged PRs to `main`. Owners: **Forge** = frontend, **Nexus** = backend/data/AI, **Sentinel** = QA/security/perf, **Atlas** = architecture review on every PR.

## Phase 0 — Foundation (Nexus, ~2 days)
- Repo scaffold: Node 20 + Fastify 5, TypeScript optional (recommend: plain JS + JSDoc for fewer toolchain bytes), ESLint, GitHub Actions CI.
- `docker-compose.yml` with `pgvector/pgvector:pg16`; migration runner; `001_init.sql` from docs/database.md.
- Layout per docs/architecture.md §5.1; `/healthz` endpoint; render a placeholder page.
- **Gate:** CI green, `docker compose up` serves a page, migrations apply cleanly.

## Phase 1 — Design system + public pages (Forge, ~3 days)
- Tokens + base.css (docs/frontend-plan.md §2), layout template (navbar, footer, skip-link, toast region), SVG sprite.
- Home page (hero, pipeline visual, How It Works, trust strip) with full SEO metadata; login/register pages with accessible forms.
- Static responsive pass at all 13 widths; axe checks clean.
- **Gate:** Home renders <2s on throttled 3G; zero a11y errors; no horizontal scroll at 320px.

## Phase 2 — Auth + profile (Nexus + Forge, ~3 days)
- Register/login/logout, argon2id, sessions, rate limiting, CSRF; `GET /api/me`.
- Profile Setup flow (first login redirect) + editable profile page with "why we ask" hints.
- **Gate:** auth flows pass unit + integration tests; profile enforced before journey creation; Sentinel security review of session handling.

## Phase 3 — Products + dashboard (Nexus + Forge, ~2 days)
- Products CRUD; My Products list with progress; dashboard (greeting, empty state, saved journeys, recent activity stub).
- **Gate:** user A cannot read/write user B's products (automated cross-user test).

## Phase 4 — Discovery consultation (Nexus + Forge, ~5 days)
- Conversation model (per-stage), messages API, orchestrator v1: context assembly (profile-aware — never re-ask), retrieval over seeded KB, structured output + validation gate.
- Journey-start UI as a guided consultation; SSE streaming with fetch fallback; subtle status lines; AI-unavailable error state.
- Seed KB with a first vertical (e.g. LED lighting) — every row sourced and `last_verified`.
- **Gate:** 20 scripted discovery conversations produce zero unsourced requirements; unknowns render as unknown.

## Phase 5 — Checklist generation + tasks (Nexus + Forge, ~4 days)
- "Create My Checklist" endpoint (idempotent), checklist page, TaskCard states, task detail page with SourceCard.
- State transitions + progress computation; locked/unlocked logic.
- **Gate:** state machine unit tests; checklist regenerates safely; sources visible on every task.

## Phase 6 — Task completion + AI continuation (Nexus + Forge, ~3 days)
- Mark as Completed confirm flow, success state, next-task unlock, "Continue with ManakAI" task-scoped assist (same conversation per stage; no repeated questions).
- Journey history page (conversations by stage, paginated).
- **Gate:** end-to-end user flow test (signup → discovery → checklist → complete → next) with JS disabled AND enabled.

## Phase 7 — Testing & labs guidance (Nexus + Forge, ~2 days)
- Journey tests endpoint + testing page; labs search from official BIS lab list with verification disclaimer and last-updated dates.
- Final summary page when journey completes.
- **Gate:** no lab row without source; disclaimer present; summary matches persisted data.

## Phase 8 — Resilience, performance, polish (Sentinel-led, ~3 days)
- Service worker app shell + offline banner (read-only checklist cache); skeleton loaders everywhere; prefers-reduced-motion verified.
- Performance budget assertions in CI; security headers check; load test on AI endpoints; rate-limit and quota verification.
- Full device/a11y matrix from docs/product.md §45 (320px → 1920px, keyboard, touch, slow network, logged out/in, first-time/returning, empty/partial/completed checklist, AI unavailable, missing product info, no matching standard).
- **Gate:** release checklist green → v0.1 demo.

## Dependencies & risk register
- Phase 4 depends on Phase 2 (profile context) — the highest-risk phase; start KB seed early (parallel from Phase 0).
- LLM provider key + cost cap must exist before Phase 4; per-user daily quota from day one.
- If ingestion lags, Phase 4 can ship with a single well-sourced vertical (LED lighting) and expand coverage after — do NOT ship unsourced categories.
- Evidence-based completion is explicitly out of MVP; `evidence` table exists for later.

## Definition of done (v0.1)
All Phase gates green · docs synchronized (any deviation from docs/ is a PR that updates docs) · no console errors · no exposed keys · WCAG AA spot-check passed on 320px/768px/1280px · demo script: LED-bulb manufacturer completes a full journey end-to-end with sources visible.
