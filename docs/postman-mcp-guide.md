# Postman MCP Guide

Workspace: `iam.rajuan_safespeak`  
Collection: `SafeSpeak Backend API`

Do not create or modify Postman collections unless the user explicitly asks. If the user asks and a Postman MCP server is available, use MCP to create or update the collection.

## Environment

- `base_url = http://localhost:5000`
- `api_prefix = /api/v1`
- `access_token =`

Use `Authorization: Bearer {{access_token}}` only for protected routes. Never store real secrets, production tokens, API keys, or client credentials.

## Current Requests

### GET Root Health

- URL: `{{base_url}}/health`
- Headers: `Accept: application/json`
- Body: none

### GET API Health

- URL: `{{base_url}}{{api_prefix}}/health`
- Headers: `Accept: application/json`
- Body: none

## Future Module Folders

Health, Auth, Consent, Reports, Evidence, AI, RAG, ScamShield, Admin, Analytics, Privacy.

For each endpoint, include method, URL, headers, example request body, example success response, and example error response.
