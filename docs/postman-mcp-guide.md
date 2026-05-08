# Postman MCP Guide

Workspace: `iam.rajuan_safespeak`  
Workspace ID: `27d5ee27-ae5a-4d01-940e-cf973d4c27e5`  
Collection: `SafeSpeak Backend API`  
Collection UID: `41974181-f21adef9-9ed7-46f2-bcb3-6f0353eacbe7`  
Environment: `SafeSpeak Local`  
Environment UID: `41974181-de5bd717-f6d6-4940-800b-450b1197c518`

Postman MCP was available and was used to recreate the collection module-wise and update the local environment. This guide mirrors the collection structure for manual verification or future MCP sync.

## Environment

- `base_url = http://localhost:5000`
- `api_prefix = /api/v1`
- `access_token =`
- `refresh_token =`
- `anonymous_session_token =`
- `user_id =`
- `report_id =`
- `evidence_id =`
- `sha256_hash =`

Use `Authorization: Bearer {{access_token}}` for protected user/admin endpoints. For anonymous flows, use `X-SafeSpeak-Session: {{anonymous_session_token}}`. Never store real production tokens, secrets, passwords, private keys, or client credentials in Postman.

## Response Pattern

Success:

```json
{
  "success": true,
  "message": "Request completed successfully",
  "data": {},
  "meta": {}
}
```

Error:

```json
{
  "success": false,
  "message": "Error message",
  "requestId": "request-id",
  "errors": []
}
```

## Frontend/Admin Notes

- `safespeak-frontend/src/lib/auth.ts` currently posts `email` and `password` to `/auth/login`.
- The frontend register form collects `fullName`, `email`, `password`, `confirmPassword`, and terms acceptance. Backend register accepts only `fullName`, `email`, and `password`.
- `safespeak-admin` login form currently collects `email`, `password`, and `rememberPassword`, but does not call the backend yet. It should map to `/auth/admin/login` with `email` and `password`.
- Dashboard/report submission views are UI-state driven at this stage, so backend payload examples follow the implemented Zod schemas.

## Health

### GET Root Health

- URL: `{{base_url}}/health`
- Auth: none
- Body: none

### GET API Health

- URL: `{{base_url}}{{api_prefix}}/health`
- Auth: none
- Body: none

## Auth

### POST Register

- URL: `{{base_url}}{{api_prefix}}/auth/register`
- Auth: none
- Body:

```json
{
  "email": "person@example.com",
  "password": "StrongPassword123!",
  "fullName": "Example Person"
}
```

### POST Login

- URL: `{{base_url}}{{api_prefix}}/auth/login`
- Auth: none
- Body:

```json
{
  "email": "person@example.com",
  "password": "StrongPassword123!"
}
```

### POST Admin Login

- URL: `{{base_url}}{{api_prefix}}/auth/admin/login`
- Auth: none
- Body:

```json
{
  "email": "admin@example.com",
  "password": "StrongPassword123!"
}
```

### POST Refresh Token

- URL: `{{base_url}}{{api_prefix}}/auth/refresh`
- Auth: none
- Body:

```json
{
  "refreshToken": "{{refresh_token}}"
}
```

### POST Logout

- URL: `{{base_url}}{{api_prefix}}/auth/logout`
- Auth: `Authorization: Bearer {{access_token}}`
- Body: none

### GET Me

- URL: `{{base_url}}{{api_prefix}}/auth/me`
- Auth: `Authorization: Bearer {{access_token}}`
- Body: none

## Sessions

### POST Create Anonymous Session

- URL: `{{base_url}}{{api_prefix}}/sessions/anonymous`
- Auth: none
- Body:

```json
{
  "language": "en",
  "jurisdiction": "NSW",
  "lga": "Sydney",
  "safetyGateAccepted": true
}
```

### GET Current Session

- URL: `{{base_url}}{{api_prefix}}/sessions/current`
- Headers: `X-SafeSpeak-Session: {{anonymous_session_token}}`
- Body: none

### POST Convert To User

- URL: `{{base_url}}{{api_prefix}}/sessions/convert-to-user`
- Headers: `X-SafeSpeak-Session: {{anonymous_session_token}}`
- Body:

```json
{
  "userId": "{{user_id}}"
}
```

## RBAC

RBAC is implemented as backend middleware/utilities for user/admin role enforcement. No standalone RBAC API endpoints are currently implemented.

## Consent

Protected by either `Authorization` or `X-SafeSpeak-Session`.

### GET Current Consent

- URL: `{{base_url}}{{api_prefix}}/consents/current`
- Body: none

### POST Update Consent

- URL: `{{base_url}}{{api_prefix}}/consents/update`
- Body:

```json
{
  "flags": {
    "store_local": true,
    "cloud_sync": true,
    "retain_evidence": true,
    "process_with_ai": false,
    "translate_content": false,
    "use_anonymised_analytics": true,
    "share_with_agencies": false,
    "warm_referral": false
  },
  "source": "user"
}
```

### POST Withdraw Consent

- URL: `{{base_url}}{{api_prefix}}/consents/withdraw`
- Body:

```json
{
  "flags": ["cloud_sync", "process_with_ai"],
  "source": "withdrawal"
}
```

### GET Consent History

- URL: `{{base_url}}{{api_prefix}}/consents/history`
- Body: none

## Profile

### GET Languages

- URL: `{{base_url}}{{api_prefix}}/languages`
- Auth: none

### GET Cultural Profiles

- URL: `{{base_url}}{{api_prefix}}/cultural-profiles`
- Auth: none

### GET Faith Profiles

- URL: `{{base_url}}{{api_prefix}}/faith-profiles`
- Auth: none

### GET Community Profiles

- URL: `{{base_url}}{{api_prefix}}/community-profiles`
- Auth: none

### GET Profile

- URL: `{{base_url}}{{api_prefix}}/profile`
- Auth: `Authorization` or `X-SafeSpeak-Session`

### PATCH Profile

- URL: `{{base_url}}{{api_prefix}}/profile`
- Auth: `Authorization` or `X-SafeSpeak-Session`
- Body:

```json
{
  "preferredLanguage": "en",
  "interpreterLanguage": "bn",
  "jurisdiction": "NSW",
  "lga": "Sydney",
  "culturalProfile": "South Asian Australian",
  "faithProfile": "Muslim",
  "communityProfile": "Migrant",
  "referralSharingPreference": false,
  "accessibilityPreferences": {
    "largeText": true
  }
}
```

## Reports

Protected by either `Authorization` or `X-SafeSpeak-Session`.

### POST Create Report

- URL: `{{base_url}}{{api_prefix}}/reports`
- Body:

```json
{
  "language": "en",
  "jurisdiction": "NSW",
  "lga": "Sydney",
  "context": "Information the user consented to store.",
  "originalNarrative": "Only stored when cloud_sync consent is true.",
  "translatedNarrative": "Optional translated narrative.",
  "incidentType": "online_abuse",
  "severity": "medium",
  "structuredFields": {
    "who": "Known account holder",
    "what": "Threatening messages were received.",
    "when": "2026-05-08",
    "where": "Online platform",
    "how": "Direct messages",
    "witnesses": "Friend saw screenshots",
    "repeatedIncidents": true,
    "injuries": "None",
    "evidenceItems": []
  },
  "status": "draft"
}
```

### GET List Reports

- URL: `{{base_url}}{{api_prefix}}/reports`

### GET Report

- URL: `{{base_url}}{{api_prefix}}/reports/{{report_id}}`

### PATCH Update Report

- URL: `{{base_url}}{{api_prefix}}/reports/{{report_id}}`
- Body:

```json
{
  "context": "Updated context.",
  "severity": "high",
  "structuredFields": {
    "what": "Updated description",
    "repeatedIncidents": true
  }
}
```

### DELETE Report

- URL: `{{base_url}}{{api_prefix}}/reports/{{report_id}}`

### POST Mark Information-Only

- URL: `{{base_url}}{{api_prefix}}/reports/{{report_id}}/mark-info-only`

### POST Withdraw Report

- URL: `{{base_url}}{{api_prefix}}/reports/{{report_id}}/withdraw`

### POST Request Report Delete

- URL: `{{base_url}}{{api_prefix}}/reports/{{report_id}}/request-delete`

### GET Report Status

- URL: `{{base_url}}{{api_prefix}}/reports/{{report_id}}/status`

### GET Report Timeline

- URL: `{{base_url}}{{api_prefix}}/reports/{{report_id}}/timeline`

## Evidence

Protected by either `Authorization` or `X-SafeSpeak-Session`. Evidence upload reservation requires `cloud_sync` consent. Completion computes SHA-256, stores an encrypted local copy, and syncs the encrypted blob to AU-region S3 when S3 variables are configured.

### POST Create Upload URL

- URL: `{{base_url}}{{api_prefix}}/evidence/upload-url`
- Body:

```json
{
  "reportId": "{{report_id}}",
  "type": "screenshot",
  "fileName": "evidence.png",
  "mimeType": "image/png",
  "size": 12345,
  "metadata": {
    "source": "mobile_upload"
  }
}
```

### POST Complete Upload

- URL: `{{base_url}}{{api_prefix}}/evidence/complete-upload`
- Body type: `form-data`
- Fields:
  - `evidenceId` as Text: `{{evidence_id}}`
  - `sha256Hash` as Text: `{{sha256_hash}}`
  - `metadata` as Text JSON object: `{"source":"mobile_upload"}`
  - `file` as File

### GET Evidence

- URL: `{{base_url}}{{api_prefix}}/evidence/{{evidence_id}}`

### GET Evidence Metadata

- URL: `{{base_url}}{{api_prefix}}/evidence/{{evidence_id}}/metadata`

### GET Evidence Audit Chain

- URL: `{{base_url}}{{api_prefix}}/evidence/{{evidence_id}}/audit-chain`

### DELETE Evidence

- URL: `{{base_url}}{{api_prefix}}/evidence/{{evidence_id}}`

### POST Verify Hash

- URL: `{{base_url}}{{api_prefix}}/evidence/{{evidence_id}}/verify-hash`
- Body:

```json
{
  "sha256Hash": "{{sha256_hash}}"
}
```

## Collection Summary

- Health: 2 endpoints
- Auth: 6 endpoints
- Sessions: 3 endpoints
- RBAC: no standalone endpoints
- Consent: 4 endpoints
- Profile: 6 endpoints
- Reports: 10 endpoints
- Evidence: 7 endpoints

Modules intentionally not added yet: AI/RAG, ScamShield, Support, Analytics, and future Admin APIs.
