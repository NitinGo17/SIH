# ManakAI — System Architecture

## 1. Guiding constraints

The architecture is driven by four hard requirements from the product definition:

1. **Old-device compatibility** — must work on 320px phones, low-end Androids, older iPhones, older Windows laptops, slow 3G. Fast first meaningful render, minimal JavaScript, progressive enhancement, no client framework.
2. **Trust & traceability** — compliance statements must be grounded in a verified knowledge base with source metadata. The AI must never invent standards, QCOs, labs, fees, or deadlines.
3. **Journey persistence** — conversations convert into structured data (checklists, tasks, progress). The user should never have to remember what the AI told them.
4. **MVP discipline** — auth, profile, products, AI journey, checklist, tasks, sources, testing guidance. Nothing more in v1.

## 2. High-level system diagram

```
                 +--------------------------------------------+
                 |              CLIENT (browser)               |
                 |  Server-rendered HTML pages (progressive    |
                 |  enhancement, no SPA framework, <40KB JS)  |
                 |  + optional Service Worker (app shell)     |
                 +-----------------+--------------------------+
                                   | HTTPS (HTML + JSON + SSE)
                 +-----------------v--------------------------+
                 |      WEB APP TIER - Node.js 20 + Fastify 5  |
                 |  +----------+ +----------+ +-----------+   |
                 |  |  Pages / | |   REST   | |   Auth    |   |
                 |  |   SSR    | |   API    | | (sessions)|   |
                 |  +----------+ +----------+ +-----------+   |
                 |  +--------------------------------------+  |
                 |  |        Application services         |  |
                 |  | Profile - Products - Journeys -     |  |
                 |  | Checklists - Tasks - Conversations  |  |
                 |  +--------------------------------------+  |
                 |  +--------------------------------------+  |
                 |  |   AI Orchestrator (server-side)     |  |
                 |  | Retrieval - Reasoning - Structured  |  |
                 |  | output validation - persistence     |  |
                 |  +--------------------------------------+  |
                 +--------+--------------------+-------------+
                          |                    |
           +--------------v---------+  +-------v-------------------+
           |  PostgreSQL 16+       |  |  LLM Provider (API)     |
           |  + pgvector 0.8.x     |  |  any OpenAI-compatible   |
           |  app data + knowledge |  |  endpoint, via server    |
           |  base + embeddings    |  |  key only (never client) |
           +----------------------+  +-------------------------+
                          ^
           +--------------+---------------+
           |  Ingestion pipeline (batch) |
           |  BIS PDFs/HTML - parse -   |
           |  chunk - embed - store     |
           |  with source metadata      |
           +----------------------------+
```

## 3. Technology decisions

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Server-rendered multi-page app (MPA)** — Fastify point-of-view templates (ETA/EJS) + vanilla ES modules + one CSS file | No SPA framework keeps JS near zero, works without JS, fast on old devices, SEO-friendly, one deployable |
| Backend | **Node.js 20 LTS + Fastify 5** | Lightweight, one language across the web tier, schema-based validation built in |
| Database | **PostgreSQL 16+ with pgvector 0.8.x** | Relational integrity for journeys/tasks + vector search for RAG in ONE database; no extra vector service |
| AI | Any OpenAI-compatible LLM endpoint, called ONLY from the backend | Provider swappable; key never leaves server |
| Auth | Session cookies (httpOnly, SameSite=Lax) + argon2id password hashing, sessions in Postgres | Simple, secure, works on old browsers; Google OAuth optional later |
| Styling | Hand-written CSS with custom properties (design tokens) | ~25–30KB total, no CSS framework |
| Icons | Inline SVG sprite (hand-picked, ~15 icons) | No icon library dependency |
| Fonts | System font stack | Zero font bytes downloaded |
| Realtime chat | Server-Sent Events if supported, else plain fetch polling fallback | Broadest old-browser compatibility |

See `docs/decisions/` for the full rationale records.

## 4. Frontend architecture (Forge's domain)

- **MPA with progressive enhancement.** Every page renders complete, readable HTML. JavaScript enhances: chat, checklist toggles, dynamic validation. If JS fails or is slow, core information and navigation still work (forms degrade to normal POST).
- **One shared layout** (header with responsive nav, footer, skip-link, toast region) + per-page templates.
- **Client JS budget: < 40KB minified+gzipped total**, plain ES modules (`/public/js/*`), loaded with `defer`. No bundler required; a simple minify step is enough.
- **CSS budget: < 30KB minified+gzipped**, mobile-first, custom properties for tokens, `prefers-reduced-motion` media query disables all decorative animation.
- **Pages that need JS islands:** journey chat, task assist chat, checklist interactions, dashboard refresh. Everything else is pure HTML/CSS.
- **Service worker (optional enhancement):** cache the app shell + last-viewed checklist JSON in a versioned cache; show cached data with an offline banner when `navigator.onLine` is false. Never claim AI works offline.

## 5. Backend architecture (Nexus's domain)

### 5.1 Module layout

```
server/
  plugins/          Fastify plugins: auth session, db pool, template engine
  routes/           pages (SSR) + /api/* (JSON)
  services/         business logic: profile, products, journeys,
                    checklists, tasks, conversations, sources
  ai/               orchestrator: prompt builder, retrieval client,
                    output schema validator, confidence classifier
  ingestion/        batch scripts: parse BIS docs, chunk, embed, upsert
  db/               migrations + seed (standards, QCOs, labs, sources)
```

### 5.2 The AI orchestrator (most safety-critical component)

The orchestrator is the ONLY place the LLM is called. It enforces the product's trust rules mechanically:

1. **Context assembly** — builds the prompt from: user profile, product context, journey state (completed tasks, current task), and retrieval results. It never asks the user for information already in the profile.
2. **Retrieval-first** — a compliance question first hits the knowledge base (pgvector similarity + keyword search). Retrieved chunks (with source metadata) are the only permitted factual grounding in the prompt.
3. **Structured output contract** — the LLM must return a strict JSON schema (validated server-side). For a discovery result:

```json
{
  "product": { "name": "...", "category": "..." },
  "requirements": [
    {
      "type": "standard | qco | test | document | certification",
      "title": "...",
      "why_it_matters": "...",
      "mandatory": "mandatory | voluntary | unknown",
      "confidence": "confirmed | likely | unknown",
      "source_ids": ["src_123"],
      "explanation": "plain language"
    }
  ],
  "open_questions": ["..."]
}
```

4. **Post-validation gate** — any requirement without a valid `source_id` is demoted to `confidence: "unknown"` and shown as "Applicability could not be conclusively determined" — or dropped. Unverifiable fields (fees, deadlines) are stripped unless present in retrieved sources.
5. **Persistence** — the validated result is written to `journey_requirements`, `tasks`, and `task_sources`. The conversation log is stored per stage.

### 5.3 Data flow: discovery → checklist

```
User answers questions (chat UI)
      |
      v
POST /api/journeys/:id/messages  -->  orchestrator
      |                                 | context assembly
      |                                 v
      |                       retrieval (pgvector + keywords)
      |                                 |
      |                                 v
      |                       LLM (structured JSON)
      |                                 |
      |                                 v
      |                       schema validation + source gate
      |                                 |
      v                                 v
conversation_messages            journey_requirements + tasks
      |
      v
User clicks "Create My Checklist"
      |
      v
POST /api/journeys/:id/checklist  -->  checklist + tasks persisted, ordered,
                                        first task unlocked
```

## 6. Knowledge base & ingestion

- **Sources ingested (MVP, manual batch):** BIS product standards pages, QCO gazette notifications, BIS recognized-laboratory lists, CRS (Compulsory Registration Scheme) notifications — each with `source` metadata: authority (BIS/MCA gazette), document title, section, URL, publication/last-updated date.
- **Pipeline:** download PDF/HTML → extract text (pdf-parse / html-to-text) → chunk (600–800 tokens with overlap, keeping section headings) → embed (provider embedding API) → store in `kb_chunks` (pgvector) with `source_id`.
- **Human review gate:** ingested standards/QCOs and their key facts are reviewed by a team member before being marked `verified` — only verified rows back a "confirmed" confidence state.
- **Never invent:** laboratory data comes only from the official BIS lab lists with a visible "verify current recognition" disclaimer and last-updated date.

## 7. API surface

REST + JSON, cookie-authenticated, CSRF-protected for writes. Full contracts in `docs/api.md`. Highlights:

- `POST /api/auth/register|login|logout`, `GET /api/me`
- `GET/PUT /api/profile`
- `GET/POST /api/products`
- `POST /api/journeys` (create for a product), `GET /api/journeys/:id`
- `POST /api/journeys/:id/messages`, `GET /api/journeys/:id/plan` (discovery result)
- `POST /api/journeys/:id/checklist` (generate), `GET /api/journeys/:id/checklist`
- `POST /api/tasks/:id/status` (state transitions), `POST /api/tasks/:id/complete`
- `POST /api/tasks/:id/assist/messages` (task-scoped continuation)
- `GET /api/journeys/:id/tests`, `GET /api/labs?test_id=`

## 8. Security architecture

- **Keys:** LLM/embedding provider keys live ONLY in server environment variables. Nothing sensitive is ever sent to or rendered by the client. No client-side calls to AI providers.
- **Auth:** argon2id password hashing (memory-hard), opaque session tokens (random 256-bit) in httpOnly Secure SameSite=Lax cookies, sessions table with expiry + rotation on login.
- **Authorization:** every request scope-checked by `userId` — users can only read/write their own profiles, products, journeys, conversations, tasks. Route-level guard + service-level `WHERE user_id = $1`.
- **Input validation:** Fastify JSON schema on every route; strict length limits; server-side validation of the LLM's structured output before persistence.
- **CSRF:** double-submit token for state-changing endpoints (or SameSite=Strict where compatible).
- **Rate limiting:** per-IP and per-user limits on auth and AI endpoints; AI endpoints also get a per-user daily quota (cost protection).
- **Headers:** CSP (no inline scripts), HSTS, X-Content-Type-Options, Referrer-Policy. Semantic HTML + CSP keep the XSS surface small; all user/AI content is rendered as text, never raw HTML.
- **No sensitive personal data collected** by design (no Aadhaar/PAN/bank details), reducing blast radius.

## 9. Performance architecture

Budgets (measured on throttled 3G, low-end Android):

| Metric | Budget |
|---|---|
| HTML document | < 20KB gzipped |
| Total CSS | < 30KB gzipped |
| Total client JS | < 40KB gzipped, `defer` |
| Images | SVG/CSS only in MVP; hero uses CSS/text, no photos |
| First meaningful paint | < 2s on slow 3G |
| Server TTFB | p95 < 300ms (pages; AI endpoints excepted) |

Tactics: server rendering (near-zero client work), system fonts, no third-party scripts, HTTP caching with ETags on static assets, `defer` scripts, skeleton loaders, pagination on history lists, connection pooling, indexed queries, streaming (SSE) for chat tokens.

## 10. Error handling & resilience

- Every failure mode maps to a user-visible state (see product.md §7) — never a blank screen.
- AI provider failure → "ManakAI couldn't complete that request. Your checklist hasn't been changed." + retry button. Server marks the conversation turn as `failed`, so history stays accurate.
- Timeouts: AI calls capped (e.g. 45s) with graceful cancellation; idempotency keys on generation endpoints so retries don't duplicate writes.
- Offline: service worker shell cache; checklist read-only view from cache with "You appear to be offline" banner; changes are queued only when sync is genuinely implemented (never claimed otherwise).

## 11. Scalability path (post-MVP)

1. **Vertical first** — a single Fastify instance + Postgres comfortably serves the MVP audience.
2. **Read scaling** — static shell cached at CDN; pages are cache-friendly per-user via ETag.
3. **AI tier** — move the orchestrator behind a queue when volume grows (job-based generation with progress polling); keeps request timeouts off the web tier.
4. **Knowledge base** — re-embedding only changed chunks; nightly incremental ingestion; versioned `kb_documents` so journeys keep the source snapshot they were built with.
5. **Evidence pipeline (future)** — task completion upgrades from self-attestation to: upload document → server-side parse → AI extraction → verification workflow. The `evidence` table exists from day one so this is additive, not a migration.
6. **Multi-tenancy / consultant mode** — a `team_members` mapping later; the ownership model (`user_id` on every root entity) makes this straightforward.

## 12. Deployment

- Single Node service + PostgreSQL (any small VPS, Render, Railway, or Fly.io for the SIH prototype).
- `docker-compose` for local dev (app + Postgres with the `pgvector/pgvector:pg16` image).
- Migrations as plain SQL files applied at deploy; ingestion scripts run offline.
- CI (GitHub Actions): lint, unit tests, integration tests against a real Postgres, accessibility checks (axe) on rendered pages, performance budget assertions.
