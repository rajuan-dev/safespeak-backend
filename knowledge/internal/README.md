# Internal Knowledge Folder

Put SafeSpeak requirement docs or extracted `.md`/`.txt`/`.json` content here for internal product-rule ingestion.

Rules:
- Do not put secrets.
- Do not put user reports.
- Do not put private legal advice.
- Do not put user conversation logs or private chats.

Recommended files:
- `safespeak-product-requirements.md`
- `safespeak-ai-rag-policy.md`

If source files are `.docx` or `.pdf`, export them to markdown/text before ingestion.

Known source documents for this repo:
- `C:\Users\RAJUAN\Documents\safespeak-docs\Safespeak (2).docx` -> `knowledge/internal/safespeak-product-requirements.md`
- `C:\Users\RAJUAN\Documents\safespeak-docs\Safespeak ai (1).docx` -> `knowledge/internal/safespeak-ai-rag-policy.md`

After placing or updating the converted files, run:
- `npm run rag:ingest:internal`
