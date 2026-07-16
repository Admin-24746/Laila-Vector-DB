# Laila Knowledge Base — Design Documentation

> A context-engineering / RAG (Retrieval-Augmented Generation) system that stores Asiacell's
> bundle, service, and rule knowledge so that the **Laila** AI agent — and the humans who build
> her flows — can retrieve accurate information instantly instead of memorizing it or digging
> through poor documentation.

**Status:** 🟢 29 design docs (00–28) drafted; all decisions D1–D18 resolved. **2026-07-15: docs 00–07
accepted → build gate OPEN; Phase 0 scaffold implemented and verified end-to-end** (stack, ingestion,
retrieval service, eval harness — see [`../README.md`](../README.md)). Still awaiting your domain DATA in
`⚠️ CONFIRM` tables: flow list (14), image categories (18), error sources (19), controlled-vocab lists
(26: service classes, locations…), data sources (27), glossary terms (28) — plus the real **seed 20**
entities and Laila-log utterances. Languages: **Iraqi Arabic + Kurdish Sorani & Badini + English**.
Channels v1 = app/web/WhatsApp text; voice/IVR future.

---

## ⛔ Build Gate

**No implementation code is written until the documents below reach "✅ Decided" on the
foundational set (00–07).** If you find yourself wanting to code before then, stop — the design
isn't locked yet. This rule is intentional.

**Status: ✅ GATE OPEN (2026-07-15).** Foundational set 00–07 reviewed & accepted; implementation began
per the Phase 0 plan (doc 11). Docs 08–13 are integration/quality/ops/enhancement layers.

---

## Reading / Authoring Order

| # | Document | Purpose | Status |
|---|----------|---------|--------|
| 00 | [Project Overview & Vision](00-project-overview-and-vision.md) | What we're building and why | ✅ Accepted |
| 01 | [Goals, Requirements & Scope](01-goals-requirements-and-scope.md) | Functional/non-functional requirements, success criteria, non-goals | ✅ Accepted |
| 02 | [Data Inventory & Entity Model](02-data-inventory-and-entity-model.md) | What knowledge exists, its shape, sources, languages | ✅ Accepted |
| 03 | [**Chunking Strategy**](03-chunking-strategy.md) ⭐ | How we split each data type — the highest-impact decision | ✅ Accepted |
| 04 | [Embedding Model Selection](04-embedding-model-selection.md) | Which model turns text into vectors | ✅ Accepted |
| 05 | [Vector Database Selection](05-vector-database-selection.md) | Which DB stores & searches the vectors | ✅ Accepted |
| 06 | [Retrieval Architecture](06-retrieval-architecture.md) | Hybrid search, metadata filtering, reranking, entity resolution, **intent routing** | ✅ Accepted |
| 07 | [Ingestion & Update Pipeline](07-ingestion-and-update-pipeline.md) | Normalization layer, incremental updates, multi-source | ✅ Accepted |
| 08 | [Integration with Laila / Druid](08-integration-with-laila-druid.md) | REST service, function-calling contract, **answer grounding guardrail** | ✅ Draft |
| 09 | [Evaluation & Quality Plan](09-evaluation-and-quality-plan.md) | How we prove answers are correct (critical) | ✅ Draft |
| 10 | [Security, Scaling & Operations](10-security-scaling-and-operations.md) | Caching, replicas, access, production-readiness, **observability** | ✅ Draft |
| 11 | [Phased Roadmap](11-phased-roadmap.md) | Prototype → production path | ✅ Draft |
| 12 | [Query Understanding & Conversational Context](12-query-understanding-and-conversational-context.md) | Multi-turn query rewriting, normalization, typo/Arabizi handling | ✅ Draft |
| 13 | [Feedback Loop & Continuous Improvement](13-feedback-loop-and-continuous-improvement.md) | Retrieval-miss logging, content-gap detection, intent tuning | ✅ Draft |
| 14 | [Flow & Intent Catalogue](14-flow-and-intent-catalogue.md) (+ out-of-domain / non-Asiacell handling) | Canonical list of flows the dispatcher routes to; deflection logic | 🟡 Draft (needs your flow list) |
| 15 | [LLM Answer & Prompt Design](15-llm-answer-and-prompt-design.md) | Persona, tone, format, language rules, grounding/refusal prompts | ✅ Draft |
| 16 | [Roaming Model](16-roaming-model.md) | Roaming as its own entity type (countries, partners, rates, activation) | ✅ Draft (needs your roaming structure) |
| 17 | [Safety: Abuse & Prompt-Injection](17-safety-abuse-and-prompt-injection.md) | Jailbreak/manipulation/abuse defenses for a customer-facing agent | ✅ Draft |
| 18 | [Multimodal Input: Image Recognition](18-multimodal-image-recognition.md) | Image routing (scratch cards, competitor cards…) + OCR; image vector collection | 🟡 Draft (needs your image categories) |
| 19 | [Error Handling & Resolution](19-error-handling-and-resolution.md) | Map system/API errors → explain to customer instead of auto-escalating | 🟡 Draft (needs your error sources) |
| 20 | [Content Management & Test Workflow](20-content-management-and-test-workflow.md) | Full CRUD + bulk ops; staging→auto-test→promote; sandbox console | ✅ Draft |
| 21 | [Content Authoring Style Guide](21-content-authoring-style-guide.md) | How to write entities/chunks consistently (manual authoring) | ✅ Draft |
| 22 | [Analytics & Business KPIs](22-analytics-and-business-kpis.md) | Deflection, escalation-reduction, coverage, language breakdown | ✅ Draft |
| 23 | [Software Testing & CI](23-software-testing-and-ci.md) | Unit/integration/contract/load/resilience tests + CI gates | ✅ Draft |
| 24 | [Human-Handoff Design](24-human-handoff-design.md) | Handoff triggers + warm context transfer to a live agent | ✅ Draft |
| 25 | [Data Dictionary & Validation](25-data-dictionary-and-validation.md) | Field-by-field schema per entity, canonical ID, units, relationships, validation | ✅ Draft |
| 26 | [Controlled Vocabularies](26-controlled-vocabularies.md) | Canonical lists (service classes, locations, providers, units…) | 🟡 Draft (needs your lists) |
| 27 | [Data Sourcing & Acquisition Map](27-data-sourcing-and-acquisition-map.md) | Which system/API/manual feeds each field + extraction | 🟡 Draft (needs your sources) |
| 28 | [Domain Glossary](28-domain-glossary.md) | Human-readable dictionary of every domain term | 🟡 Draft (needs your terms) |

⭐ = highest-impact decision.

---

## Open Decisions Register

Decisions deliberately deferred until their document. Tracked here so nothing is forgotten.

| ID | Decision | Where it's resolved | Status |
|----|----------|--------------------|--------|
| D1 | Canonical storage language (English-only + cross-lingual / all 3 languages / pivot+translate) | 03, 04 | ✅ Resolved — per-language chunks (store all) |
| D2 | Which crisp rules live as **structured data** vs **vectorized prose** | 02, 03 | ✅ Resolved — dual (both) |
| D3 | Embedding model: local BGE-M3 vs hosted multilingual API | 04 | ✅ Resolved — BGE-M3 self-hosted (TEI) |
| D4 | Vector DB product (Qdrant / Weaviate / pgvector / …) | 05 | ✅ Resolved — Qdrant self-hosted |
| D5 | Kurdish coverage: **both Sorani + Kurmanji**, Arabic + Latin script + romanized-Kurdish mitigation | 04 | 🟡 Mitigated — measured in doc 09 |
| D6 | Reranker yes/no for prototype | 06 | ✅ Resolved — OFF for prototype, revisit via eval |
| D7 | Intent-routing mechanism (pure vector vs vector+LLM tie-breaker) + confidence/abstain thresholds | 06 | ✅ Resolved — vector-first + threshold/margin + LLM tie-breaker + abstain |
| D8 | Conversational query-rewriting approach (when/how to rewrite follow-ups) | 12 | ✅ Resolved — gated LLM rewrite + raw/rewrite merge fallback |
| D9 | Feedback capture mechanism + how it feeds content/intent improvement | 13 | ✅ Resolved — passive logging + periodic triage → eval |
| D10 | Image-recognition approach (self-host multimodal embeddings vs vision-LLM vs hybrid) | 18 | ✅ Resolved — Hybrid (local CLIP/SigLIP classify + vision-LLM OCR) |
| D11 | Out-of-domain / non-Asiacell handling (deflect vs general answer vs handoff) | 14 | ✅ Resolved — polite reasoned deflection + brand-neutrality policy |
| D12 | Error handling (auto-escalate vs vector-DB error catalogue) | 19 | ✅ Resolved — error catalogue + pre-check + explain; escalate only as fallback |
| D13 | Content management & test approach (CRUD/bulk + how to test new content) | 20 | ✅ Resolved — CRUD/bulk CLI + staging→auto-test→promote + sandbox |
| D14 | Personalization (account-aware vs general answers) | 15 | ✅ Resolved — Mix: general knowledge + account-aware eligibility/errors |
| D15 | Eligibility data split (DB vs live API) | 02 | ✅ Resolved — static eligibility = metadata; dynamic per-customer = live BSS API |
| D16 | Canonical ID scheme | 25 | ✅ Resolved — `entity_id={type}_{bundleId}`; offerId secondary; save COMPLETE record |
| D17 | Model entity relationships | 25 | ✅ Resolved — yes (service→bundles, conflicts, offers) |
| D18 | Unit normalization | 25 | ✅ Resolved — normalize all (MB/days/IQD/min/sms ints) + keep display strings |

---

## Foundational Principles (the spine of every doc)

1. **Deterministic decisions stay in code.** Eligibility (service class / whitelist / history → yes/no)
   is never answered by the LLM or by vector similarity. The vector DB supplies *knowledge*, not *verdicts*.
2. **One embedding model, many generation LLMs.** The DB is independent of whether a flow uses
   Gemini or ChatGPT. Standardize the embedding model; the generation LLM is free to vary.
3. **Two consumers.** The knowledge base serves both Laila at runtime *and* flow-builders at design time.
4. **Small corpus, huge traffic.** The knowledge is small (hundreds of items); the user base is large.
   Scale with caching + replicas, not exotic vector tech.
5. **Docs before code.** This folder is the contract.
