# MongoDB Atlas Vector Search Setup

- Collection name: `ragchunks`
- Vector field path: `embedding`
- Index name: value of `RAG_VECTOR_INDEX` in `.env` (default `rag_chunks_vector_index`)
- Source filter fields stored directly on chunks: `sourceId`, `sourceCategory`, `jurisdiction`, `topic`
- Source approval strategy: query approved sources from `ragknowledgesources` first, then filter chunk search to those `sourceId` values
- Embedding model: `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- Expected dimensions:
  - `text-embedding-3-small` -> `1536`
  - `text-embedding-3-large` -> `3072`
  - if you intentionally shorten embeddings with a dimensions parameter in custom code, the Atlas index must match that exact output size

Sample Atlas Vector Search index JSON:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    },
    { "type": "filter", "path": "sourceId" },
    { "type": "filter", "path": "sourceCategory" },
    { "type": "filter", "path": "jurisdiction" },
    { "type": "filter", "path": "topic" }
  ]
}
```

Create manually in Atlas:
1. Open cluster -> Database -> `ragchunks` collection.
2. Go to Search Indexes -> Create Index -> JSON Editor.
3. Use index name from env `RAG_VECTOR_INDEX`.
4. Paste JSON and set `numDimensions` for your configured embedding model.
5. Save and wait until the index is active.

Validation:
- Run `npm run rag:check:index`
- If Mongo returns `SearchNotEnabled`, Atlas Search / Vector Search is not enabled on the connected deployment yet.
- If the index name is missing, create it manually and rerun the check.

Notes on filtering:
- Chunk-level filter fields in `$vectorSearch`:
  - `sourceId`
  - `sourceCategory`
  - `jurisdiction`
  - `topic`
- Legal/public approval is enforced at source-query time before chunk retrieval:
  - `status=approved`
  - `legalReviewed=true` for `official_legal_source`

RAG retrieval will not work correctly until Atlas Search is enabled, the named index exists, and the embedding dimensions match the configured embedding model.
