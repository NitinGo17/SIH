# ManakAI — Frontend Plan (Forge)

## 1. Approach

Server-rendered multi-page app. Fastify renders full HTML templates; vanilla ES-module JavaScript progressively enhances specific islands (chat, checkboxes, toasts). No SPA framework, no UI library, no icon package, no web fonts. Everything must remain readable and navigable with JavaScript disabled.

```
server/
  templates/          # layout + page templates (ETA/EJS)
    layout.eta        # head, skip-link, header/nav, footer, toast region
    home.eta  login.eta  register.eta  profile.eta  dashboard.eta
    products.eta  journey-start.eta  checklist.eta  task-detail.eta
    task-assist.eta  testing.eta  summary.eta  history.eta
  public/
    css/base.css      # ONE stylesheet, <30KB gzipped, tokens + components + pages
    js/               # ES modules, loaded with defer
      chat.js         # journey + task-assist islands (fetch + optional SSE)
      checklist.js    # checkbox + completion interactions
      nav.js          # hamburger, bottom-nav active state, toasts
      offline.js      # service worker registration + offline banner
    sw.js             # app-shell cache, versioned
    icons.svg         # inline SVG sprite (~15 icons)
```

## 2. Design system (tokens)

```css
:root {
  /* Identity (brand palette, WCAG AA verified on Pearl):
     Midnight Indigo ink · Pearl bg · Slate secondary · Electric Blue primary · Copper accent */
  --c-bg: #f7f8fa;            --c-surface: #ffffff;
  --c-ink: #17153b;           --c-ink-2: #242733;   /* AA on bg */
  --c-primary: #3155d9;  --c-primary-hover: #2743b8;  --c-primary-ink: #fff;
  /* Copper #d98b5f is decorative-only (borders/fills/dots; 2.5:1 on Pearl).
     Text variants keep the hue at AA levels: */
  --c-accent: #d98b5f;        /* decorative */
  --c-accent-strong: #c87845; /* large accent text >=3:1 */
  --c-accent-ink: #9c5626;    /* small accent text >=4.5:1 */
  --c-success: #1c7c4a;  --c-warn: #9a6700;  --c-danger: #b4232a;
  --c-border: #e3e6ee;
  --c-primary-soft: #e9edfb;  --c-accent-soft: #f8ede4;
  --r-sm: 6px; --r-md: 10px; --r-lg: 16px;
  --shadow-1: 0 1px 2px rgba(23, 21, 59, .06);
  --shadow-2: 0 2px 8px rgba(23, 21, 59, .08);
  --space-1: 4px; ... --space-8: 64px;   /* 4px scale */
  --fs-body: 1rem; --fs-sm: .875rem; --fs-h1: clamp(1.75rem, 5vw, 3rem);
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

Style character: generous whitespace, subtle 1px borders, soft shadows, rounded cards, restrained gradients, strong typographic hierarchy, micro-interactions on buttons/cards/progress only.

## 3. Components (all hand-built)

Navbar (desktop + hamburger + auth-aware) · BottomNav (mobile app pages) · Hero · CTAButton · ProfileForm · ProductForm · ChatInterface · ChatMessage · JourneyProgress · ProgressIndicator · Checklist · ChecklistCard / TaskCard · TaskDetail · SourceCard · TestingCard · LabCard · Dashboard panels · Modal (native <dialog> where supported, fallback) · Toast · LoadingState (skeletons) · EmptyState · ErrorState · ConfidenceBadge (Confirmed / Requires verification / Unknown — icon + label + text, never color alone).

## 4. Key screens
- **Home:** hero (MANAKAI / "From Product to Compliance." / supporting text / CTAs) + CSS-only pipeline visual Product → Requirements → Checklist → Testing → Compliance + How It Works + trust strip (sources, no exaggerated claims). SEO: title, meta description, Open Graph, single h1, crawlable content.
- **Journey start:** consultation header "Let's understand your product." — question card + answer input + progress dots; NOT a chat wall. If JS is off, form POSTs to the same endpoint and re-renders.
- **Checklist:** product header, ProgressIndicator (42%), numbered task cards with state icon + label (✓ Completed / ● In Progress / 🔒 Locked), Continue button on the active task.
- **Task detail:** TASK 02 header, WHY THIS MATTERS, WHAT YOU NEED TO DO (checkboxes), WHAT YOU MAY NEED, SOURCE (SourceCard), actions: Continue with ManakAI / Mark as Completed (opens confirm: "Have you completed this task?" Yes / Not Yet).
- **Completion:** success state "Stage completed. Your next step is ready." + Continue to next / Return to checklist / Review previous stage.
- **Dashboard:** greeting by time of day, product card, progress %, current stage, next action, Continue Journey, recent activity, upcoming tasks, saved journeys.
- **Empty states:** illustrated with SVG line art, one sentence + one CTA. E.g. "Your compliance journey starts with understanding your product."

## 5. Responsive requirements
- Mobile-first CSS. Breakpoints: 480, 768, 1024 (max-width container ~1080px).
- Tested at 320, 360, 375, 390, 414, 480, 600, 768, 820, 1024, 1280, 1440, 1920.
- Small screens: stacked cards, reduced padding, full-width buttons, 44x44px minimum touch targets, no hover-only functionality, horizontal scroll only for unavoidable tables (wrapped in a focusable scroll container with `tabindex="0"` and a label).
- `env(safe-area-inset-bottom)` padding for the bottom nav on notched phones.

## 6. Accessibility contract (WCAG 2.1 AA)
- Semantic landmarks (header/nav/main/footer), skip link, one h1 per page, logical heading order.
- All form fields: visible <label>, described-by hint text, aria-describedby errors, focus management on validation failure.
- Visible focus states on all interactive elements (never outline: none without replacement).
- Status always icon + text ("Completed ✓"), never color-only. ConfidenceBadge: "Confirmed ✓", "Requires verification !", "Unknown ?".
- aria-live="polite" region for AI status lines and toasts.
- Decorative SVGs aria-hidden; meaningful images have alt.
- Keyboard: every flow completable without a mouse (chat, modals, task completion).

## 7. Browser support baseline
- Graceful on: Chrome 60+, Firefox 60+, Safari iOS 12+, Edge 79+, Android WebView (Chrome 60+).
- Progressive enhancements gated behind feature detection: SSE, <dialog>, CSS grid (flex fallback), :focus-visible, view transitions (not used), service worker.
- No ES2020+ syntax without a build step (or keep a tiny esbuild pass to ES2018 to be safe).
- Zero console errors on supported browsers.

## 8. Performance budget (enforced in CI)
- HTML < 20KB gz · CSS < 30KB gz · JS < 40KB gz (deferred) · no web fonts · no third-party scripts · first meaningful paint < 2s on throttled slow-3G/low-end Android.
