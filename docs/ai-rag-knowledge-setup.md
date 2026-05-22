# AI/RAG Knowledge Setup

## OpenAI key vs RAG knowledge

`OPENAI_API_KEY` lets SafeSpeak call models and create embeddings. It does not train or preload SafeSpeak rules.
RAG works only after sources are ingested, chunked, embedded, stored, indexed, and approved.

## Internal docs ingestion

1. Convert `.docx`/`.pdf` to `.md` or `.txt`.
2. Put files in `knowledge/internal/`.
3. Recommended names:

- `knowledge/internal/safespeak-product-requirements.md`
- `knowledge/internal/safespeak-ai-rag-policy.md`

4. Run: `npm run rag:ingest:internal`
5. This ingester:

- computes `sha256Hash`
- skips unchanged files on repeat runs
- re-ingests changed files and bumps `version`
- creates `RagKnowledgeSource` records as `sourceCategory=internal_product_rule`
- creates `RagChunk` records and embeddings with `OPENAI_EMBEDDING_MODEL`
- never treats internal SafeSpeak docs as legal authority

## Official source ingestion

1. Edit `knowledge/official-sources/sources.sample.json` with official URLs only, or use `knowledge/official-sources/sources.mvp.json` as the MVP starter corpus.
2. Run: `npm run rag:ingest:official` or `npm run rag:ingest:official:mvp`.
3. Official ingestion now does one of two safe paths:

- HTML/text pages on allowed official domains are fetched, text-extracted, chunked, embedded, and stored.
- Binary or hard-to-parse sources such as PDF/DOC/DOCX are stored as metadata only with `ingestionStatus=metadata_only` and a clear reason in `ingestionError` or metadata.

4. Official sources default to `status=pending_review` and `legalReviewed=false`.
5. Official legal/support sources must include `publisher`, `licenseStatus`, `lastUpdated`, and `nextRefreshAt` before approval.
6. Only approved official legal sources with `legalReviewed=true` and a future `nextRefreshAt` are used in public legal RAG answers.

## Approval workflow

- Only admin endpoints can approve/reject sources.
- Public RAG retrieval uses approved sources only.
- `legalReviewed` remains `false` by default for official legal sources.
- Material changes to an approved source return it to `pending_review`.
- Approved official legal/support sources are excluded from retrieval after `nextRefreshAt` passes.

## Vector index

Follow `docs/mongodb-vector-search-setup.md` and create Atlas Vector Search index before testing retrieval.
Run `npm run rag:check:index` to verify whether Atlas Search is enabled and whether the named index exists.

## Readiness report

Run `npm run rag:readiness` after ingestion and legal review updates. The report matches the admin readiness panel and returns:

- whether any public legal RAG source is currently eligible for citations
- official-source blocker counts
- jurisdiction/topic coverage cells
- metadata-only, failed-ingestion, no-chunk, refresh, approval, and legal-review gaps

Use `npm run rag:readiness -- --fail-on-not-ready` in release checks when the deployment must fail unless at least one approved, current, legally reviewed official legal source is citation-ready.

## Test endpoints

- `POST /api/v1/rag/search`
- `POST /api/v1/rag/answer`
- `GET /api/v1/rag/knowledge-sources`
- `GET /api/v1/rag/knowledge-sources/readiness`
- `POST /api/v1/rag/knowledge-sources/:id/approve`
- `POST /api/v1/rag/knowledge-sources/:id/reject`

## What not to ingest

- User reports
- User chats/private messages
- Screenshots of private conversations
- Private legal advice memos
- Secrets or credentials

## Example commands

- `npm run rag:check:index`
- `npm run rag:ingest:internal`
- `npm run rag:ingest:official`
- `npm run rag:ingest:official:mvp`
- `npm run rag:readiness`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run format:check`
