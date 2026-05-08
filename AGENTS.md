# AGENTS.md

## Project Identity

Project: SafeSpeak Backend  
Stack: Node.js, Express.js, TypeScript, MongoDB/Mongoose, Zod, Pino  
Purpose: backend foundation for a trauma-informed, multilingual triage and intelligence platform for racism, hate speech, online abuse, scams, discrimination, and related harms in Australia.

SafeSpeak is not a crisis service, not legal advice, not counselling, and not a case-management system.

## Current Phase

Foundation setup only.

Do not implement business modules unless the user explicitly requests them. This includes Auth, Reports, Evidence, AI, RAG, ScamShield, Admin, Analytics, Privacy workflows, routing engines, or fake business data.

## Efficient Inspection

Avoid repeated full-project scans. Start with:

- `package.json` for scripts and dependencies
- `src/app.ts` for Express composition
- `src/server.ts` for bootstrapping
- `src/config/env.ts` for environment rules
- `src/routes/index.ts` for versioned routes
- `src/modules/<module>` for module-specific behavior
- `README.md` for setup and project standards

Use `rg --files` and targeted `rg` searches instead of broad recursive reads.

## Module Placement

Future modules go in `src/modules/<module-name>/`.

Recommended module files:

- `<module>.routes.ts`
- `<module>.controller.ts`
- `<module>.service.ts`
- `<module>.schema.ts` for Zod validation
- `<module>.model.ts` for Mongoose schemas only when needed
- `<module>.types.ts` for module-specific types

Register public module routes in `src/routes/index.ts`.

## Naming Conventions

- Files use kebab-case or clear dot suffixes, for example `request-id.middleware.ts`.
- Classes use PascalCase.
- Functions and variables use camelCase.
- Environment variables use UPPER_SNAKE_CASE.
- API paths use kebab-case nouns.

## API Response Standard

Success:

```json
{
  "success": true,
  "message": "Human-readable message",
  "data": {},
  "meta": {}
}
```

Error:

```json
{
  "success": false,
  "message": "Human-readable message",
  "requestId": "uuid",
  "errors": []
}
```

Use `successResponse()` and `errorResponse()` from `src/common/responses/api-response.ts`.

## Error Handling Standard

- Throw `ApiError` for operational errors.
- Use `asyncHandler()` for async controllers.
- Let `error.middleware.ts` produce the final JSON error response.
- Include validation details in `errors`; do not leak secrets or stack traces in production.

## Environment Rules

- `.env.example` is tracked and is the source of truth for local setup.
- `.env` and `.env.*` are ignored.
- Validate env vars with Zod in `src/config/env.ts`.
- Never hardcode secrets, production tokens, API keys, private credentials, or client secrets.

## Security Rules

- Keep Helmet, CORS, rate limiting, request IDs, and structured logging active.
- Redact tokens, cookies, passwords, and secrets from logs.
- Do not store unnecessary sensitive data.
- Future sensitive workflows must be consent-first and privacy-aware.

## Commit and Change Rules

- Keep changes scoped to the user request.
- Do not revert unrelated user changes.
- Do not add business endpoints unless explicitly requested.
- Run `npm run typecheck` and `npm run lint` after meaningful code changes when dependencies are installed.
- Summaries should list what changed, verification performed, and any known follow-up.

## Postman MCP Policy

- The target Postman workspace name is "iam.rajuan_safespeak".
- Do not create or modify Postman collections unless the user explicitly asks.
- If the user asks to create API docs/requests in Postman and a Postman MCP server is available, use MCP to create or update the collection.
- Collection name should be "SafeSpeak Backend API".
- Organize requests by module folders, for example Health, Auth, Consent, Reports, Evidence, AI, RAG, ScamShield, Admin, Analytics, Privacy.
- For each endpoint, include method, URL, headers, example request body, example success response, and example error response.
- Use environment variables:
  - `base_url = http://localhost:5000`
  - `api_prefix = /api/v1`
  - `access_token = empty by default`
- Use `Authorization: Bearer {{access_token}}` only for protected routes.
- Never store real secrets, production tokens, API keys, or client credentials in Postman.
- If MCP is not available, create or update `docs/postman-mcp-guide.md` with the exact collection structure and request definitions so the user can manually import or later sync with MCP.

## Avoid Token Waste

- Read only files relevant to the current task.
- Prefer targeted searches over opening entire directories.
- Do not restate the full architecture unless the user asks.
- Reuse existing conventions from nearby files.
- Keep final summaries concise and action-oriented.

## Change Summary Format

After each task, summarize:

- What changed
- Files touched or created
- Verification run
- Known limitations or next recommended prompt
