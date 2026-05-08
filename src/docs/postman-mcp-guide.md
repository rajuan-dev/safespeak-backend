# Postman MCP Guide

## Workspace

Target workspace: `iam.rajuan_safespeak`

## Collection

Collection name: `SafeSpeak Backend API`

Do not create or modify Postman collections unless the user explicitly asks. If a Postman MCP server is available and the user asks for Postman docs or requests, use MCP to create or update this collection.

## Environment Variables

- `base_url = http://localhost:5000`
- `api_prefix = /api/v1`
- `access_token =`

Use `Authorization: Bearer {{access_token}}` only for protected routes. Never store real secrets, production tokens, API keys, or client credentials in Postman.

## Current Endpoints

### Health / Root

- Method: `GET`
- URL: `{{base_url}}/health`
- Headers:
  - `Accept: application/json`
- Example success response:

```json
{
  "success": true,
  "message": "Service is healthy",
  "data": {
    "status": "ok",
    "service": "SafeSpeak Backend",
    "environment": "development",
    "timestamp": "2026-05-08T00:00:00.000Z",
    "uptime": 10,
    "version": "1.0.0"
  },
  "meta": {}
}
```

### Health / API v1

- Method: `GET`
- URL: `{{base_url}}{{api_prefix}}/health`
- Headers:
  - `Accept: application/json`
- Example success response: same as root health.

## Future Folder Structure

Organize requests by module folders:

- Health
- Auth
- Consent
- Reports
- Evidence
- AI
- RAG
- ScamShield
- Admin
- Analytics
- Privacy

For each future endpoint include method, URL, headers, example request body, example success response, and example error response.
