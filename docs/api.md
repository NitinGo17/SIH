# ManakAI — API Contracts

All endpoints are served by the Node/Fastify backend. Authentication is a session cookie (httpOnly). Write endpoints require a CSRF token (double-submit header). Every response is JSON (API) or HTML (pages). Errors use a consistent envelope:

```json
{ "error": { "code": "AI_UNAVAILABLE", "message": "ManakAI couldn't complete that request. Your checklist hasn't been changed." } }
```

Error codes: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_CREDENTIALS`, `EMAIL_TAKEN`, `AI_UNAVAILABLE`, `RATE_LIMITED`, `QUOTA_EXCEEDED`, `OFFLINE_UNSYNCED`, `CONFLICT`, `UNAVAILABLE` (503 — a backend dependency such as the database is not configured or reachable).

## 1. Auth

| Method & path | Body | Response |
|---|---|---|
| `POST /api/auth/register` | `{name, email, password}` | `201 {userId}` + session cookie. First-login flag set. |
| `POST /api/auth/login` | `{email, password}` | `200 {userId, profileComplete}` |
| `POST /api/auth/logout` | — | `204` |
| `GET /api/me` | — | `200 {userId, name, email, profileComplete, productCount, activeJourneyCount}` |

Password policy: min 8 chars; no composition theatre. Rate limit: 10 attempts / 15 min / IP.

## 2. Profile

| Method & path | Body | Response |
|---|---|---|
| `GET /api/profile` | — | `{businessName, businessType, industry, isComplete}` |
| `PUT /api/profile` | same fields (partial ok) | `200` updated profile |

`businessType` ∈ msme | startup | manufacturer | importer | entrepreneur | other.

## 3. Products

| Method & path | Body | Response |
|---|---|---|
| `GET /api/products` | — | `[{id, name, category, origin, complianceStage, journeyProgress}]` |
| `POST /api/products` | `{name, category?, origin?, manufacturingLocation?, intendedUse?, complianceStage?}` | `201` product |
| `GET /api/products/:id` | — | `200` product |
| `PUT /api/products/:id` | partial fields | `200` |
| `DELETE /api/products/:id` | — | `204` (confirm in UI; cascades journeys) |

## 4. Journeys

| Method & path | Body | Response |
|---|---|---|
| `POST /api/journeys` | `{productId}` | `201 {journeyId, status:'discovery'}` |
| `GET /api/journeys/:id` | — | `{id, product, status, progressPct, currentTask, stageCounts}` |

## 5. Discovery (Start the Journey)

`POST /api/journeys/:id/messages`

```json
// request
{ "content": "LED bulbs" }
// response (assistant turn)
{
  "messageId": "...",
  "reply": "What is the primary intended use?",
  "ask": { "type": "question", "field": "intended_use" },
  "phase": "gathering"            // gathering | summarizing | done
}
```

`GET /api/journeys/:id/plan` — the validated discovery result (requirements with confidence + sourceIds), and:

```json
{
  "ready": true,
  "summary": {
    "product": "LED Bulbs",
    "industry": "Electrical / Lighting",
    "requirements": [
      { "type": "standard", "title": "IS 10322-5-2", "mandatory": "mandatory",
        "confidence": "confirmed", "sourceIds": ["..."] }
    ],
    "tests": [ { "testId": "...", "name": "...", "purpose": "..." } ],
    "certification": [ ... ]
  }
}
```

The assistant never asks for data available in the profile — the orchestrator pre-fills from profile context and only asks for gaps.

### Streaming variant (SSE)

`GET /api/journeys/:id/messages/stream?content=<message>`

Incremental delivery of the same assistant turn `POST /api/journeys/:id/messages` returns. Request with `Accept: text/event-stream`; the user's message is supplied as the `content` query parameter. The response is `Content-Type: text/event-stream` and emits ordered `event: token` frames — `data: {"text": "…"}` chunks that concatenate to the full `reply` — followed by a terminal `event: done` frame whose `data` is the exact POST-response object (`{ messageId, reply, ask, phase }`). The turn is persisted server-side before any frame is streamed, so a dropped connection never loses the assistant turn. On failure before the stream opens, the standard JSON error envelope is returned with the usual status codes (`UNAUTHENTICATED`, `NOT_FOUND`, `VALIDATION_ERROR`, `AI_UNAVAILABLE`). Clients without `EventSource` fall back to the POST turn.

## 6. Checklist

| Method & path | Body | Response |
|---|---|---|
| `POST /api/journeys/:id/checklist` | — (idempotent per journey+discovery version) | `201 {checklistId, taskIds[]}` — tasks ordered, task 1 unlocked |
| `GET /api/journeys/:id/checklist` | — | `{progressPct, tasks: [{id, position, title, stage, state, completedAt}]}` |

## 7. Tasks

`GET /api/tasks/:id`

```json
{
  "id": "...", "position": 2, "title": "Verify Product Requirements",
  "stage": "requirements",
  "state": "in_progress",
  "explanation": "...why this matters...",
  "requirements": [ {"label": "Verify material", "done": true} ],
  "documents": ["Product specification", "Technical documentation"],
  "sources": [
    { "authority": "BIS", "documentTitle": "...", "section": "...",
      "lastVerified": "2026-09-01", "url": "https://bis.gov.in/..." }
  ]
}
```

| Method & path | Body | Response |
|---|---|---|
| `POST /api/tasks/:id/status` | `{state: "in_progress"}` (valid transitions only) | `200` task |
| `POST /api/tasks/:id/complete` | — | `200 {task, nextTask, journeyProgressPct}` — server unlocks next task and recomputes progress |
| `POST /api/tasks/:id/requirements` | `{label, done}` | `200` (checkbox state) |

Valid state transitions: `locked → not_started` (server-side unlock only), `not_started ↔ in_progress`, `not_started/in_progress → completed`, `completed → in_progress` (reopen). `requires_verification` set by the system for low-confidence tasks.

## 8. Task-scoped AI continuation

`POST /api/tasks/:id/assist/messages`

```json
// request
{ "content": "Where do I get the dimensions tested?" }
// response
{
  "messageId": "...",
  "reply": "...task-specific guidance...",
  "citations": [ { "sourceId": "...", "title": "...", "url": "..." } ],
  "suggestedAction": { "type": "complete_task", "label": "Mark as Completed" }
}
```

Context sent to the orchestrator (server-side): profile, product, journey tasks with states, current task, its requirements. The AI must not re-ask answered questions.

## 9. Testing & labs

| Method & path | Response |
|---|---|
| `GET /api/journeys/:id/tests` | `[{testId, name, purpose, status}]` |
| `GET /api/labs?testId=` or `?capability=` | `[{name, city, state, capabilities, website, source, lastVerified}]` — only rows from the official BIS list; response always includes `"disclaimer": "Verify current recognition and availability with BIS."` |

## 10. Conventions

- UUIDs as ids. ISO-8601 timestamps. Pagination: `?page=&pageSize=` (default 20) on history/product lists.
- SSE variant for chat streaming at `GET /api/journeys/:id/messages/stream` (implemented — see §5; clients without `EventSource` still fall back to POST).
- All list endpoints cap page size at 100.
