# MongoDB Atlas Vector Search Setup

- Chunks collection: `ragchunks`
- Embedding field: `embedding`
- Source filter fields stored on chunks: `sourceId`, `sourceCategory`, `jurisdiction`, `topic`
- Source approval filter: `status` is enforced from `ragknowledgesources` at query-time (approved only)
- Embedding model: `${OPENAI_EMBEDDING_MODEL}` (default `text-embedding-3-small`)
- Embedding dimensions: set this to the configured model's dimension in your environment/runtime config.

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

RAG retrieval will not work correctly until this index exists and is active.
