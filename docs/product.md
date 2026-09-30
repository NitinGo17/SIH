# ManakAI — Product Definition

**From Product to Compliance.**

## 1. Project Summary

ManakAI is an AI-powered BIS compliance guidance platform for Indian MSMEs, manufacturers, startups, importers, and product businesses. Many small businesses do not know which Bureau of Indian Standards (BIS) requirements apply to their product, whether certification is mandatory (e.g. under a Quality Control Order, QCO) or voluntary, what tests are needed, or where to start. Compliance information is scattered across gazette notifications, standards documents, and government portals written in regulatory language.

ManakAI solves this with a guided journey:

**User Profile → Product Discovery → AI Guidance → Personalized Compliance Checklist → Task Completion → Next Task → Testing / BIS Lab Guidance → Certification**

The AI does the complicated reasoning in the background. The user sees: what applies to them, what they have completed, what they need to do next, why they need to do it, what evidence/documents may be required, and where the information came from.

**ManakAI is NOT primarily a chatbot.** The chat is an intelligence interface inside a larger compliance journey. The product is a guided consultation that becomes a persistent, structured checklist.

> The chatbot explains. The checklist remembers. The journey guides. The sources establish trust. The user completes the work.

### Non-goals (MVP)

- Payments / subscriptions
- Social features, gamification beyond simple progress
- Analytics dashboards for users
- Admin marketplace or consultant marketplace
- Push/email notification systems
- Evidence-upload verification with automated document parsing (designed for, not built in MVP)

## 2. User Types

| Type | Description | Primary need |
|---|---|---|
| MSME owner | Small manufacturer or trader, little compliance knowledge | Plain-language guidance, low effort |
| Product startup | Building a hardware/product business | Know if BIS certification is mandatory before launch |
| Importer | Imports goods covered by QCOs | Know import-time compliance requirements |
| Manufacturer | Makes products in India | Testing and certification path |
| Entrepreneur / new business | Exploring an idea | Understand the compliance landscape early |
| Compliance personnel / consultant (secondary) | Manages compliance for clients | Multi-product tracking, sources |

**Design rule:** never assume the user understands BIS terminology. Use simple language. When technical terms are necessary (QCO, conformity assessment, ISI mark, CRS), explain them inline.

**Data-minimisation rule:** never ask for Aadhaar, PAN, bank details, or financial information. Ask only what improves guidance.

## 3. Core Features

1. **Authentication** — email/password registration and login. Optional Google OAuth later. First login → Profile Setup; returning login → Dashboard.
2. **Profile** — business context (name, business name, business type, industry) that gives the AI persistent context. Editable. Explains why each field is requested.
3. **Products** — users can track multiple products (Product A 78%, Product B 25%, Product C completed). One account, many journeys.
4. **Start the Journey (AI discovery)** — a guided consultation, not a chat window. The AI asks only the questions it needs, using profile context automatically, then produces: applicable standards, relevant QCOs, mandatory vs voluntary classification, testing requirements, documentation requirements — each with confidence state and sources.
5. **Checklist generation** — one click converts the discovery result into a structured, personalized compliance checklist (the heart of the product).
6. **Checklist & task states** — tasks move through LOCKED → NOT STARTED → IN PROGRESS → COMPLETED (and REQUIRES VERIFICATION for uncertain items). State is always communicated with icon + label + text, never color alone.
7. **Task detail** — why this matters, what to do, what you may need, official sources, and two actions: Continue with ManakAI / Mark as Completed.
8. **Task-scoped AI continuation** — "Continue with ManakAI" opens the same journey context (profile, product, completed tasks, current task). The AI never restarts the conversation or re-asks answered questions.
9. **Task completion & next step** — success state → "Your next step is ready" → continue to next task, return to checklist, or review the previous stage. Never a forced workflow.
10. **Journey history** — conversations stored per stage (Discovery, Requirements, Testing, Documentation, Certification), not one endless transcript.
11. **Testing & lab guidance** — required tests (name, purpose, status) and official information on relevant BIS-recognized laboratories when available. Never invented. Always with a "verify current recognition" disclaimer.
12. **Final compliance summary** — full journey summary with sources and outstanding actions.
13. **Source traceability everywhere** — Source: BIS, document title, relevant section, last updated, official link.
14. **Trust communication** — CONFIRMED / LIKELY–REQUIRES VERIFICATION / UNKNOWN states on all compliance statements.

## 4. Primary User Flows

### Flow A — First visit → signup → profile → dashboard
1. User lands on Home, reads hero + how it works, clicks **Start Your Journey**.
2. Not logged in → Login/Register screen (email, password, name for registration).
3. First login → **Profile Setup** (business context + product context) with explanation of why each field is asked.
4. Profile saved → Dashboard (empty state: "Your compliance journey starts with understanding your product" + Start Your Journey).

### Flow B — Discovery consultation → checklist
1. Dashboard → **Start Your Journey** → "Let's understand your product."
2. AI asks only necessary questions (product, intended use, market, manufacture vs import). Skips anything the profile already answers.
3. AI presents a summary: product, industry, applicable requirements, testing requirements, certification requirements — with confidence states and sources.
4. "Your compliance journey is ready." → **Create My Checklist**.
5. Checklist is generated and persisted; user lands on the checklist page with progress 0% and task 01 unlocked.

### Flow C — Working the checklist
1. Checklist → open task 01 → read why it matters / what to do / what you may need / sources.
2. **Continue with ManakAI** → task-scoped AI helps complete the task (same journey context).
3. **Mark as Completed** → confirm dialog ("Have you completed this task?" Yes/Not Yet) → success state "Stage completed. Your next step is ready."
4. User continues automatically, returns to checklist, or reviews the previous stage.
5. Progress updates; next task unlocks.

### Flow D — Testing stage
1. Reaching the testing task shows required tests (name, purpose, status).
2. **Find a Relevant Lab** → official BIS-recognized laboratory information (name, location, capability, source, contact) with verification disclaimer.

### Flow E — Completion
1. All tasks completed → final summary: product, standards, testing, documents, certification status, outstanding actions, source references.
2. Journey marked completed; product shows "Completed" in My Products.

### Flow F — Returning user
1. Login → Dashboard: greeting, product, progress %, current stage, next action, **Continue Journey**, recent activity, upcoming tasks, saved journeys.

## 5. Page / Screen Structure

| # | Route | Page | Auth | Notes |
|---|---|---|---|---|
| 1 | `/` | Home | Public | SEO-optimized landing: hero, how it works, trust |
| 2 | `/login`, `/register` | Auth | Public | Email + password; Google later |
| 3 | `/profile`, `/profile/setup` | Profile | User | Business + product context, editable |
| 4 | `/dashboard` | Dashboard | User | Greeting, journey status, activity |
| 5 | `/products` | My Products | User | Multi-product list with progress |
| 6 | `/journey/start` | Start the Journey | User | Guided AI consultation (discovery) |
| 7 | `/journey/:id/checklist` | Checklist | User | The heart of the product |
| 8 | `/journey/:id/task/:taskId` | Task Detail | User | Why / what / needs / sources / actions |
| 9 | `/journey/:id/task/:taskId/assist` | Task-scoped AI | User | Continuation within journey context |
| 10 | `/journey/:id/testing` | Testing & Labs | User | Required tests + lab guidance |
| 11 | `/journey/:id/summary` | Final Summary | User | Complete journey summary + sources |
| 12 | `/journey/:id/history` | Journey History | User | Conversations per stage |
| 13 | `/offline` | Offline notice | Public | Shown when network unavailable |

**Navigation**
- Desktop: Logo · Home · Start the Journey · Profile · [Login] or [User avatar].
- Mobile: Logo · hamburger (Home, Start the Journey, Profile, Login/Logout). Bottom bar for Home / Journey / Profile on the app pages.
- Navigation adapts to auth state. No unnecessary items.

## 6. Content & Microcopy Rules

Write like a helpful consultant, not a government portal:

| Don't write | Write |
|---|---|
| "Initiate conformity assessment procedures." | "Start the certification process." |
| "Non-compliance detected." | "This requirement still needs attention." |
| "Query the regulatory knowledge base." | "Ask ManakAI." |

- Error example: "We couldn't verify this requirement right now. Your existing checklist has not been changed."
- Loading: "Analyzing your product…", "Checking applicable requirements…", "Building your compliance journey…"
- Uncertainty: "Applicability could not be conclusively determined from the available information."
- Never: "100% accurate", "Guaranteed compliance", "Government approved".

## 7. States to Design

- **Empty states**: no journey, no products, no conversation at a stage, no matching standard, empty search.
- **Error states**: AI unavailable, slow connection, backend unavailable, invalid login, missing profile info, incomplete product info, conflicting sources, outdated info, unknown applicability. Never a blank screen.
- **Loading states**: skeleton loaders (not spinners); subtle AI status lines.
- **Offline**: "You appear to be offline." Cached checklist remains viewable.

## 8. Visual Hierarchy (applies to every screen)

1. What product am I working on? 2. Where am I in the journey? 3. What have I completed? 4. What do I need to do next? 5. Why do I need to do it? 6. What source supports this requirement? Everything else is secondary.
