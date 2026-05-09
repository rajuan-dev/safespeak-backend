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

## Official source ingestion
1. Edit `knowledge/official-sources/sources.sample.json` with official URLs only.
2. Run: `npm run rag:ingest:official`
3. This currently creates approved-domain source metadata as `pending_review`; URL content fetching is intentionally not auto-enabled.

## Approval workflow
- Only admin endpoints can approve/reject sources.
- Public RAG retrieval uses approved sources only.
- `legalReviewed` remains `false` by default for official legal sources.

## Vector index
Follow `docs/mongodb-vector-search-setup.md` and create Atlas Vector Search index before testing retrieval.

## Test endpoints
- `POST /api/v1/rag/search`
- `POST /api/v1/rag/answer`
- `GET /api/v1/rag/knowledge-sources`
- `POST /api/v1/rag/knowledge-sources/:id/approve`
- `POST /api/v1/rag/knowledge-sources/:id/reject`

## What not to ingest
- User reports
- User chats/private messages
- Screenshots of private conversations
- Private legal advice memos
- Secrets or credentials

## Example commands
- `npm run rag:ingest:internal`
- `npm run rag:ingest:official`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run format:check`
