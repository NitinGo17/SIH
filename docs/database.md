# ManakAI — Database Design

PostgreSQL 16+ with the **pgvector** extension (0.8.x). One database holds both the application data and the compliance knowledge base (embeddings in `kb_chunks`).

## 1. Entity overview

```
users 1--1 profiles
users 1--* products
products 1--* journeys
journeys 1--* conversations (one per stage)
conversations 1--* messages
journeys 1--* journey_requirements (typed: standard/qco/test/document/certification)
journeys 1--1 checklists
checklists 1--* tasks
tasks *--* requirements (task_requirements)
tasks 1--* evidence (future)
standards / qcos / laboratories / sources  (knowledge base, curated)
kb_documents 1--* kb_chunks (vector embedded)
```

## 2. Schema (DDL summary)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- ============ IDENTITY ============

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  password_hash text NOT NULL,              -- argon2id; NULL if OAuth-only later
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash    text PRIMARY KEY,           -- sha256 of the session token
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- ============ PROFILE ============

CREATE TABLE profiles (
  user_id               uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  business_name         text,
  business_type         text CHECK (business_type IN
                          ('msme','startup','manufacturer','importer','entrepreneur','other')),
  industry              text,
  is_complete           boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ============ PRODUCTS ============

CREATE TABLE products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  category             text,
  origin               text CHECK (origin IN ('manufactured','imported')),
  manufacturing_location text,
  intended_use         text,
  compliance_stage     text CHECK (compliance_stage IN
                         ('exploring','product_development','testing','certification','already_certified')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_user_idx ON products(user_id);

-- ============ JOURNEYS ============

CREATE TABLE journeys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- denormalised for auth checks
  status        text NOT NULL DEFAULT 'discovery'
                 CHECK (status IN ('discovery','active','completed','abandoned')),
  progress_pct  smallint NOT NULL DEFAULT 0,
  current_task_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journeys_user_idx ON journeys(user_id);

-- Conversations are stored PER STAGE, not as one giant transcript.
CREATE TABLE conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  stage         text NOT NULL CHECK (stage IN
                 ('discovery','requirements','testing','documentation','certification')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, stage)
);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','assistant','system')),
  content         text NOT NULL,
  status          text NOT NULL DEFAULT 'ok'   -- ok | failed | truncated
                  CHECK (status IN ('ok','failed','truncated')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_idx ON messages(conversation_id, created_at);

-- ============ DISCOVERY RESULTS ============

-- The structured output of the AI discovery, validated before persistence.
CREATE TABLE journey_requirements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN
                 ('standard','qco','test','document','certification')),
  title         text NOT NULL,
  explanation   text NOT NULL DEFAULT '',     -- plain language
  why_it_matters text NOT NULL DEFAULT '',
  mandatory     text NOT NULL DEFAULT 'unknown'
                 CHECK (mandatory IN ('mandatory','voluntary','unknown')),
  confidence    text NOT NULL DEFAULT 'unknown'
                 CHECK (confidence IN ('confirmed','likely','unknown')),
  standard_id   text REFERENCES standards(is_number),   -- nullable, e.g. IS 302-2-1
  qco_id        uuid REFERENCES qcos(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journey_req_idx ON journey_requirements(journey_id);

-- ============ CHECKLIST & TASKS ============

CREATE TABLE checklists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    uuid NOT NULL UNIQUE REFERENCES journeys(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id  uuid NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  position      smallint NOT NULL,
  title         text NOT NULL,
  explanation  text NOT NULL DEFAULT '',      -- why this matters
  requirements  jsonb NOT NULL DEFAULT '[]',   -- [{label, done:false}]
  documents     jsonb NOT NULL DEFAULT '[]',   -- ["Product specification", ...]
  stage         text NOT NULL CHECK (stage IN
                 ('understand','requirements','testing','documentation','certification')),
  state         text NOT NULL DEFAULT 'locked'
                 CHECK (state IN ('locked','not_started','in_progress','completed','requires_verification')),
  completed_at  timestamptz,
  UNIQUE (checklist_id, position)
);

CREATE TABLE task_requirements (        -- which discovered requirements back this task
  task_id        uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  journey_requirement_id uuid NOT NULL REFERENCES journey_requirements(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, journey_requirement_id)
);

CREATE TABLE task_sources (            -- traceability for every task
  task_id        uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_id      uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, source_id)
);

-- Future: evidence-based completion. Schema exists from day one; UI is MVP-later.
CREATE TABLE evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind          text NOT NULL,           -- test_report | certificate | photo | document
  file_key      text,                    -- object-store key when uploads are enabled
  extracted     jsonb,                   -- AI-extracted structured fields
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============ KNOWLEDGE BASE (curated) ============

CREATE TABLE sources (                  -- every compliance fact points here
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority     text NOT NULL,           -- 'BIS' | 'Gazette of India' | ...
  document_title text NOT NULL,
  section       text,
  url           text NOT NULL,
  published_at  date,
  last_verified date NOT NULL,           -- team review date
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE standards (
  is_number     text PRIMARY KEY,        -- e.g. 'IS 302-2-1'
  title         text NOT NULL,
  description   text,
  latest_source uuid REFERENCES sources(id),
  verified      boolean NOT NULL DEFAULT false
);

CREATE TABLE qcos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,           -- Quality Control Order name
  gazette_no    text,
  effective_date date,
  source_id     uuid NOT NULL REFERENCES sources(id),
  verified      boolean NOT NULL DEFAULT false
);

CREATE TABLE qco_products (             -- product categories covered by a QCO
  qco_id        uuid NOT NULL REFERENCES qcos(id) ON DELETE CASCADE,
  category      text NOT NULL,           -- free text + keyword list for matching
  PRIMARY KEY (qco_id, category)
);

CREATE TABLE laboratories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  city          text,
  state         text,
  capabilities   text[] NOT NULL DEFAULT '{}',
  website       text,
  source_id     uuid NOT NULL REFERENCES sources(id),
  last_verified date NOT NULL,
  verified      boolean NOT NULL DEFAULT false
);
CREATE INDEX labs_capability_idx ON laboratories USING gin(capabilities);

CREATE TABLE tests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  purpose       text NOT NULL,
  standard_id   text REFERENCES standards(is_number),
  source_id     uuid NOT NULL REFERENCES sources(id)
);

CREATE TABLE journey_tests (            -- required tests for one journey
  journey_id    uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  test_id       uuid NOT NULL REFERENCES tests(id),
  status        text NOT NULL DEFAULT 'not_started'
                 CHECK (status IN ('not_started','in_progress','completed')),
  PRIMARY KEY (journey_id, test_id)
);

-- ============ KNOWLEDGE BASE (retrieval) ============

CREATE TABLE kb_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     uuid NOT NULL REFERENCES sources(id),
  content_hash  text NOT NULL,           -- skip unchanged documents on re-ingest
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, content_hash)
);

CREATE TABLE kb_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  chunk_index   int NOT NULL,
  text          text NOT NULL,
  embedding     vector(768) NOT NULL,     -- match provider embedding size
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX kb_chunks_vec_idx ON kb_chunks
  USING hnsw (embedding vector_cosine_ops);
```

## 3. Design notes

- **`user_id` denormalised onto journeys** so every authorization check is one `WHERE user_id = $1` — no join needed for the route guard.
- **Conversations are keyed by `(journey_id, stage)`** — this is what makes "journey history by stage" and "Continue with ManakAI without restarting" trivial.
- **`journey_requirements` is the validated AI discovery result**, separated from `tasks` (the checklist). A discovery can be re-run without destroying an existing checklist; tasks reference requirements via `task_requirements`.
- **`confidence` / `mandatory` are enums, not booleans** — the trust model needs `unknown` and `likely`, not just true/false.
- **`sources` is the single table for traceability.** Every compliance-critical row (standards, QCOs, labs, tests, tasks) points at it. The UI renders: Source (authority), Document title, Relevant section, Last updated, View Official Source.
- **`evidence` exists from day one** so evidence-based completion (upload → AI extraction → verification) is added without a migration.
- **`progress_pct` is derived, not authoritative** — recomputed on task state change: `completed_tasks / total_tasks`.
- **Migrations:** plain numbered SQL files (`db/migrations/001_init.sql` …), applied by a tiny runner script. No ORM required; thin `pg` query layer with typed row mappers is enough.

## 4. Seed data (MVP)

Seed via `db/seed/` with real, sourced rows only:
1. A starter set of commonly-asked standards (household electrical appliances, LED lighting, steel products, toys, cement, etc.) — from bis.gov.in pages, with source URLs.
2. QCO notifications relevant to those categories — from Gazette/e-gazette entries.
3. BIS-recognized laboratory list — from the official BIS list; `last_verified` set to ingestion date; UI always shows the verification disclaimer.

Every seed row MUST carry `source_id` and `last_verified`. No invented data, ever.
