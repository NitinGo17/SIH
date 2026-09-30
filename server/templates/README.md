# Template contract (for routes)

Rendering pattern (Fastify + Eta):

1. Render the page body template (`home.eta`, `login.eta`, ...) with its data.
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

Login/register templates expect an optional `error` string (server-side
validation), rendered inside `role="alert"` with `aria-invalid` + `aria-describedby`
already wired. Forms POST to `/login` and `/register` so every flow works
with JavaScript disabled.

## Asset budgets (ADR-0001, checked in CI)

- HTML < 20 KB gzipped · CSS < 30 KB gzipped · JS < 40 KB gzipped
- `base.css` is the ONLY stylesheet. `icons.svg` is the ONLY icon source.
- No web fonts, no third-party scripts, no UI library.
