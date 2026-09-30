# Template contract (for routes)

Rendering pattern (Fastify + Eta):

1. Render the page body template with its data.
2. Render `layout.eta` passing `content` (the rendered body string) plus:

| Variable | Purpose |
|---|---|
| `title` | Full `<title>` text, brand included (e.g. `Log in · ManakAI`) |
| `description` | `<meta name="description">` |
| `og` | Optional Open Graph meta tags (string, raw HTML) |
| `user` | Session user object or `null`; drives the auth-aware nav |
| `appNav` | `'home' | 'journey' | 'profile' | null` — active item in the mobile bottom nav; `null` on public pages |
| `mainClass` | `'has-bottom-nav'` on app pages that show the bottom nav |
| `content` | Pre-rendered page body |

## Page data contracts

Every page renders server-side with the shape below (all fields map to
docs/api.md responses — no invented fields). All states are template
conditionals: empty, error, success.

| Template | Key data |
|---|---|
| `home.eta` | — (static) |
| `login.eta` / `register.eta` | `error` (string \| null) |
| `profile.eta` | `profile {businessName, businessType, industry}`, `saved` (bool), `error` |
| `dashboard.eta` | `user {name}`, `greeting` (time-of-day string), `products [{id, name, category, journeyProgress, currentStage, nextAction, journeyId}]`, `activity [{when, text}]` |
| `products.eta` | `products [{id, name, category, origin, complianceStage, journeyProgress, journeyId}]` |
| `journey-start.eta` | `journeyId`, `messages [{role, content}]`, `question`, `step`, `totalSteps`, `planReady`, `plan {product, industry, requirements[], tests[]}`, `error` (`'AI_UNAVAILABLE'` renders the resilience copy) |
| `checklist.eta` | `journeyId`, `product {name}`, `progressPct`, `tasks [{id, position, title, stage, state, completedAt}]`, `error` |
| `task-detail.eta` | `journeyId`, `task {id, position, title, stage, state, explanation, requirements [{label, done}], documents[], sources[]}`, `completed` (bool), `nextTask {id, title} \| null` |
| `task-assist.eta` | `journeyId`, `task {id, position, title}`, `messages [{role, content, citations[]}]` |
| `testing.eta` | `journeyId`, `tests [{testId, name, purpose, status}]`, `labs` (null = no search yet, [] = no match), `selectedTestId`, `disclaimer` |
| `summary.eta` | `journeyId`, `product`, `standards [{title, confidence}]`, `tests`, `documents`, `certification {status, note}`, `outstanding`, `sources[]` |
| `history.eta` | `journeyId`, `stages [{name, messages[], lastActive}]`, `page`, `pageCount` |
| `offline.eta` | — |

Shared partials in `templates/partials/`: `source-card` (`s`), `task-state` (`t`),
`confidence` (`r`), `empty-products`, `plan-summary` (uses `it.plan`).

## JS islands

- Forms keep `action` as the **page route** (no-JS fallback) and expose the
  JSON endpoint via `data-api` (docs/api.md paths). `chat.js` prefers `data-api`.
- `checklist.js` needs `meta[name="csrf-token"]` on app pages (Phase 2 backend).
- All islands are ES2018-safe, IIFE-wrapped, and fail silently when the
  backend is absent.

## Asset budgets (ADR-0001, checked in CI)

- HTML < 20 KB gzipped · CSS < 30 KB gzipped · JS < 40 KB gzipped
- `base.css` is the ONLY stylesheet. `icons.svg` is the ONLY icon source.
- No web fonts, no third-party scripts, no UI library.
