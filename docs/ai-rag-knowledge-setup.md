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

## OCR ingestion

SafeSpeak now supports OCR-gated ingestion for scanned PDFs and image uploads, but it is intentionally conservative.

Required env:

- `RAG_ENABLE_OCR=true|false`
- `OCR_PROVIDER=tesseract|google_vision|aws_textract|azure_document_intelligence|none`
- `OCR_MIN_CONFIDENCE=0.85`
- `OCR_MAX_PAGES=100`
- `OCR_BATCH_SIZE=5`
- `OCR_PAGE_TIMEOUT_MS=60000`
- `OCR_JOB_TIMEOUT_MS=0`
- `OCR_LANGUAGE=eng`
- `OCR_REVIEW_REQUIRED=true`

Recommended local dev default:

- `RAG_ENABLE_OCR=true`
- `OCR_PROVIDER=tesseract`
- `OCR_MAX_PAGES=0` for no fixed page-count limit
- `OCR_BATCH_SIZE=5`
- `OCR_PAGE_TIMEOUT_MS=60000`
- `OCR_JOB_TIMEOUT_MS=0`

Local Tesseract path:

1. Install Node dependency support: already included via `tesseract.js`.
2. For image OCR, no extra SafeSpeak code changes are needed.
3. For PDF OCR with the local Tesseract provider, install Poppler so `pdftoppm` is available on `PATH`.
4. Optional but useful: install `pdfinfo` as part of Poppler so page-count warnings are more accurate.

Current OCR behavior:

- Text PDFs still use normal text extraction and bypass OCR when the extracted text quality is good.
- Scanned or image-only PDFs can go through OCR when `RAG_ENABLE_OCR=true`.
- `OCR_MAX_PAGES=0` means SafeSpeak will not apply a fixed page-count cap.
- Large scanned PDFs are processed in batches instead of loading every page into memory at once.
- `OCR_BATCH_SIZE` controls how many PDF pages are rendered and OCR-processed in each batch.
- `OCR_PAGE_TIMEOUT_MS` applies to each page OCR attempt.
- `OCR_JOB_TIMEOUT_MS=0` means no total OCR job timeout, but per-page timeout still applies.
- PNG/JPG/JPEG/TIFF uploads can go through OCR.
- OCR output is blocked from indexing when confidence is too low, the text is too short, too many pages fail, or the result looks like symbol-heavy garbage.
- Official legal OCR sources are not retrievable until OCR review is completed.
- OCR review metadata is stored on the source and chunk records.

Admin OCR endpoints:

- `POST /api/v1/rag/knowledge-sources/:id/run-ocr`
- `POST /api/v1/rag/knowledge-sources/:id/approve-ocr`
- `GET /api/v1/rag/knowledge-sources/:id/ocr-preview`
- `GET /api/v1/rag/knowledge-sources/:id/status`

Runtime OCR request overrides:

```json
{
  "maxPages": 0,
  "batchSize": 5,
  "pageTimeoutMs": 60000,
  "jobTimeoutMs": 0,
  "force": false
}
```

Preview pagination:

- `GET /api/v1/rag/knowledge-sources/:id/ocr-preview?page=1&pageSize=5`

Review workflow:

1. Upload the document.
2. If normal extraction is weak and OCR is disabled, the source becomes `requires_ocr`.
3. If OCR is enabled, run OCR automatically during ingestion or manually with `run-ocr`.
4. If OCR confidence is too low, the source becomes `ocr_low_confidence` or `ocr_failed` and is not indexed.
5. If OCR succeeds, the source becomes `pending_ocr_review` when review is required.
6. Approve OCR with `approve-ocr` before relying on legal OCR content in retrieval.
7. After OCR approval, the source can be chunked and indexed through the same legal-aware ingestion path.

Limitations:

- The local Tesseract provider needs a PDF renderer for scanned PDFs. Without Poppler and `pdftoppm`, PDF OCR fails loudly instead of silently indexing bad text.
- Batched scanned-PDF OCR also needs `pdfinfo` from Poppler so SafeSpeak can determine total page count and track progress safely.
- Cloud OCR providers are stubbed for clean future integration but are not fully implemented in this task.
- OCR is for ingestion only; it does not change SafeSpeak’s chat policy or legal-answer behavior by itself.

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
- whether `OPENAI_API_KEY` and the configured Atlas Vector Search index are available for retrieval
- official-source blocker counts
- jurisdiction/topic coverage cells
- metadata-only, failed-ingestion, no-chunk, refresh, approval, and legal-review gaps

Use `npm run rag:readiness -- --fail-on-not-ready` in release checks when the deployment must fail unless at least one approved, current, legally reviewed official legal source is citation-ready and retrieval configuration is complete.

## Test endpoints

- `POST /api/v1/rag/search`
- `POST /api/v1/rag/answer`
- `GET /api/v1/rag/knowledge-sources`
- `GET /api/v1/rag/knowledge-sources/readiness`
- `POST /api/v1/rag/knowledge-sources/:id/approve`
- `POST /api/v1/rag/knowledge-sources/:id/run-ocr`
- `POST /api/v1/rag/knowledge-sources/:id/approve-ocr`
- `GET /api/v1/rag/knowledge-sources/:id/ocr-preview`
- `GET /api/v1/rag/knowledge-sources/:id/status`
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
