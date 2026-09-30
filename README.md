# ManakAI

**From Product to Compliance.**

ManakAI is an AI-powered BIS compliance guidance platform for Indian MSMEs, manufacturers, startups, importers, and product businesses. It converts an AI-guided consultation about your product into a persistent, structured, actionable compliance journey — a personalized checklist with sources, testing guidance, and progress tracking.

> The chatbot explains. The checklist remembers. The journey guides. The sources establish trust. The user completes the work.

## What ManakAI is

A guided journey: **User profile → Product discovery → AI guidance → Personalized compliance checklist → Task completion → Next task → Testing / BIS lab guidance → Certification**.

It is NOT a chatbot with a landing page. The AI does the reasoning in the background; the user sees what applies to them, what they have completed, what to do next, why, what evidence is required, and where the information came from.

## Documentation

| Document | Purpose |
|---|---|
| [docs/product.md](docs/product.md) | Product definition: users, features, user flows, screens, microcopy, states |
| [docs/architecture.md](docs/architecture.md) | System architecture, AI/RAG pipeline, security, performance, scalability |
| [docs/database.md](docs/database.md) | Data model and database schema |
| [docs/api.md](docs/api.md) | REST API contracts |
| [docs/frontend-plan.md](docs/frontend-plan.md) | Design system, components, responsive and accessibility requirements |
| [docs/implementation-order.md](docs/implementation-order.md) | Phased build plan with milestones, owners, and QA gates |
| [docs/decisions/](docs/decisions/) | Architecture Decision Records |

## Core rules (non-negotiable)

1. **Never invent compliance data.** No BIS standards, QCOs, labs, fees, deadlines, or legal requirements may be generated without a traceable source. Unknown means unknown.
2. **Every compliance statement is traceable.** Source, document, section, last-updated date, and official link are stored in the database and shown in the UI.
3. **The frontend consumes structured backend data.** Compliance answers are never hardcoded in frontend components.
4. **Trust over claims.** No "100% accurate", "guaranteed compliance", or "government approved" language unless officially supported. ManakAI is guidance, not official BIS approval.
5. **Old-device first.** 320px phones, low-end Androids, older iPhones, slow 3G. Performance and accessibility are first-class requirements, not polish.

## Team

- **Atlas** — Product Architect & System Designer
- **Forge** — UI/UX & Frontend Engineer
- **Nexus** — Backend, Database & API Engineer
- **Sentinel** — QA, Security, Performance & Deployment Engineer

All cross-agent work is coordinated through GitHub issues in this repository.

## License

MIT (to be confirmed by the team).
