# Knowledge-base ingestion

Two batch scripts populate the curated knowledge base. Both follow the same
rule (ADR-0002, README core rule #1): **no row without a traceable source.**
Rows are stored `verified = false` until the team has reviewed them against the
official document; only verified rows back `confirmed` answers in the UI.

| Script | Manifest | Populates |
|---|---|---|
| `ingest.js` | `seed/led-lighting.json` | `sources`, `kb_documents`, `kb_chunks`, `standards` (documents + embeddings) |
| `ingest-labs.js` | any labs manifest | `sources`, `laboratories`, `tests` (structured rows, no embeddings) |

## Running

```bash
cd server
node ingestion/ingest.js ingestion/seed/led-lighting.json
node ingestion/ingest-labs.js <path-to-labs-manifest.json>
# or, via npm:
npm run seed                       # LED-lighting documents
npm run seed:labs -- <manifest>    # laboratories + tests
```

`DATABASE_URL` must point at the Postgres 16 + pgvector instance
(`docker-compose.yml`). Both scripts are idempotent — re-running updates the
existing rows rather than duplicating them.

## Laboratories + tests manifest

Every row must carry a `source` object with `authority`, `title`, `url` and
`last_verified`; a row missing any of these is rejected. Laboratory data must
come only from the official BIS recognized-laboratory list, and the UI always
shows the "verify current recognition" disclaimer with the `last_verified` date.

```json
{
  "laboratories": [
    {
      "name": "…",
      "city": "…",
      "state": "…",
      "capabilities": ["…"],
      "website": "https://…",
      "verified": true,
      "source": {
        "authority": "BIS",
        "title": "BIS recognized laboratories list",
        "section": "…",
        "url": "https://…",
        "published_at": "2026-01-01",
        "last_verified": "2026-09-30"
      }
    }
  ],
  "tests": [
    {
      "name": "…",
      "purpose": "…",
      "standard": "IS 10322-5-3",
      "source": { "authority": "BIS", "title": "…", "section": "…",
                  "url": "https://…", "last_verified": "2026-09-30" }
    }
  ]
}
```

- `verified` is optional and defaults to `false`. Set it to `true` only after a
  reviewer has checked the row against the official source.
- `standard` is optional; when present it links the test to
  `standards.is_number` so the UI can show the applicable standard.
- Lab capabilities are free-text keywords; `/api/labs?capability=` matches
  against them.

> The manifests shipped with the repo intentionally contain no laboratory or
> test data yet — those rows must be transcribed from the official BIS sources
> before ingestion (tracked as a `[Backend]` handoff issue). This script exists
> so that sourced data can be ingested the moment it is available.
