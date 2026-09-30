# ADR-0002: Retrieval-grounded AI with a validation gate

**Status:** Accepted — 2026-09-30 · **Deciders:** Atlas

## Context

ManakAI gives compliance guidance. The single biggest risk is hallucinated BIS standards, QCOs, lab names, fees, or deadlines presented as fact. Trust is the product. At the same time, the LLM cannot be trusted to know Indian regulatory content reliably, and we must never hardcode compliance answers into frontend components.

## Decision

1. All LLM calls happen in one server-side module (the AI orchestrator). The client never talks to an AI provider.
2. Facts are grounded by retrieval over a curated knowledge base (Postgres + pgvector): standards, QCOs, recognized labs — each row carrying a `sources` reference (authority, document title, section, URL, last-verified date).
3. The LLM must return structured JSON matching a schema. A server-side validation gate runs before persistence: any requirement without a valid source_id is demoted to `confidence: unknown` ("Applicability could not be conclusively determined") or dropped; fees/deadlines not present in retrieved sources are stripped.
4. Confidence is a first-class enum everywhere: confirmed | likely | unknown. The UI renders it as icon + label, and never presents AI interpretation as official BIS approval.

## Consequences
- + Hallucination is structurally constrained, not prompt-hoped.
- + Every journey keeps traceable sources; a re-ingested knowledge base version doesn't corrupt old journeys (task_sources snapshot).
- + Provider-agnostic: any OpenAI-compatible endpoint; swapping models touches one module.
- − Quality depends on ingestion discipline; unverified gaps surface as "unknown" rather than guessed answers (by design).
- − RAG latency on discovery; acceptable with SSE streaming + subtle status lines.
