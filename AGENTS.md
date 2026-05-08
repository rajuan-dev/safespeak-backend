# AGENTS.md - SafeSpeak Backend

## Project Identity

Project: SafeSpeak Backend  
Stack: Node.js, Express.js, TypeScript, MongoDB, future Redis/BullMQ, future S3, future AI/RAG.

SafeSpeak is a trauma-informed, multilingual triage and intelligence platform for racism, hate speech, online abuse, scams, discrimination, and related harms in Australia.

SafeSpeak is not:

- a crisis service
- legal advice
- counselling
- a case-management system
- an automatic reporting service

All future AI/legal-style outputs must be information-only and must use disclaimers.

## Current Phase

Current phase: backend foundation setup only.

Do not implement business modules unless the user explicitly asks.

Do not implement:

- Auth
- Reports
- Evidence Vault
- AI/RAG
- ScamShield
- Admin APIs
- Analytics
- External integrations

Only health check and project foundation are allowed during the initial setup phase.

## Token-Saving Rules for AI Agents

To reduce token usage:

1. Do not scan the whole repository unless necessary.
2. First inspect:
   - `README.md`
   - `package.json`
   - `src/routes/index.ts`
   - `src/app.ts`
   - related module folder only
3. When modifying a module, inspect only that module and its shared dependencies.
4. Do not rewrite unrelated files.
5. Do not restate the full project context in every response.
6. Summarize changes shortly after each task.
7. Prefer small, focused edits over large rewrites.
8. Ask no unnecessary questions if the user already gave enough instructions.
9. Do not generate long explanations unless requested.
10. Keep implementation aligned with existing project structure.

## Folder Rules

Main source folder:

```txt
src/
├── config/
├── common/
├── modules/
├── routes/
├── workers/
└── docs/
```

Recommended module shape:

```txt
src/modules/module-name/
├── module-name.routes.ts
├── module-name.controller.ts
├── module-name.service.ts
├── module-name.model.ts
├── module-name.schema.ts
├── module-name.types.ts
└── module-name.constants.ts
```

Only create files that are actually needed.

## Naming Conventions

Use:

- kebab-case for filenames
- camelCase for variables/functions
- PascalCase for classes/types/interfaces
- UPPER_SNAKE_CASE for constants
- RESTful route naming
- `/api/v1` as the API prefix

## API Response Standard

All success responses must follow:

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {},
  "meta": {}
}
```

All error responses must follow:

```json
{
  "success": false,
  "message": "Error message",
  "requestId": "request-id",
  "errors": []
}
```

## Error Handling Rules

- Use centralized error handling.
- Do not throw raw strings.
- Use `ApiError` for operational errors.
- Controllers should use async handlers.
- Never leak stack traces in production responses.

## Environment Rules

- Never hardcode secrets.
- Never commit `.env`.
- Keep `.env.example` updated when new env variables are added.
- Use Zod validation for environment variables.

## Security Rules

Always consider:

- consent-first data storage
- no data storage without permission
- no PII leakage in logs
- no raw secrets in code
- no fake production credentials
- no unsafe CORS wildcard in production
- rate limiting for public APIs
- helmet/security headers
- input validation with Zod

## SafeSpeak Domain Rules for Future Work

Future modules must respect:

- Safety gate before sensitive flow.
- Explicit consent before cloud sync, AI processing, analytics, or external sharing.
- No automatic reporting to agencies.
- AI output must be information-only, not legal advice.
- Admins must not access raw PII unless explicit permission and audit reason exist.
- Evidence must be hashed and audited.
- Analytics must be anonymised and threshold-protected.
- Legal/RAG sources must be official, public, and legally approved.

## Postman MCP Policy

Target Postman workspace:

```txt
iam.rajuan_safespeak
```

Collection name:

```txt
SafeSpeak Backend API
```

Do not create or modify Postman collections unless the user explicitly asks.

If the user asks to create API requests in Postman and a Postman MCP server is available:

- Use MCP to create or update the collection.
- Use workspace `iam.rajuan_safespeak`.
- Use collection `SafeSpeak Backend API`.
- Organize requests by module folders:
  - Health
  - Auth
  - Sessions
  - Consent
  - Profile
  - Reports
  - Evidence
  - AI
  - RAG
  - ScamShield
  - Support
  - Education
  - Admin
  - Analytics
  - Privacy
  - Audit

Use Postman environment variables:

```txt
base_url = http://localhost:5000
api_prefix = /api/v1
access_token =
refresh_token =
```

For public endpoints:

- Do not add Authorization header.

For protected endpoints:

- Use `Authorization: Bearer {{access_token}}`.

Never store:

- real production tokens
- API keys
- passwords
- client secrets
- private certificates

If Postman MCP is not available:

- Do not fail the task.
- Create or update `docs/postman-mcp-guide.md`.
- Include method, URL, headers, request body, success response, and error response.
- Tell the user MCP was not available and the guide was created for later import/sync.

## Current Postman Endpoints

Initial foundation endpoints:

```txt
GET {{base_url}}/health
GET {{base_url}}{{api_prefix}}/health
```

## Change Rules

Before editing:

- Identify the smallest relevant files.
- Do not modify unrelated code.

After editing:

- Run typecheck if available.
- Run lint if available.
- Summarize changed files and what changed.

## Response Style for AI Agents

Keep responses concise and technical.

Include:

- what was changed
- files created/updated
- commands to run
- any warnings or next steps

Do not include unnecessary long explanations unless the user asks.

Use this as the first setup prompt. After Codex completes this, the next prompt should be for: **Auth + Anonymous Session + RBAC + Consent + Profile + Report foundation**.
