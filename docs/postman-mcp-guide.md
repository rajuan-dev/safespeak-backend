# Postman MCP Guide

Workspace: `iam.rajuan_safespeak`  
Collection: `SafeSpeak Backend API`

Postman MCP was not available in this Codex session. This guide is maintained so the collection can be manually imported or later synced through MCP.

## Environment

- `base_url = http://localhost:5000`
- `api_prefix = /api/v1`
- `access_token =`
- `refresh_token =`
- `anonymous_session_token =`

Use `Authorization: Bearer {{access_token}}` only for protected routes. Use `X-SafeSpeak-Session: {{anonymous_session_token}}` for anonymous-session protected routes. Never store real production tokens, API keys, passwords, client secrets, or private certificates.

## Health

### GET Root Health

- URL: `{{base_url}}/health`
- Headers: `Accept: application/json`
- Body: none
- Success: `200`

### GET API Health

- URL: `{{base_url}}{{api_prefix}}/health`
- Headers: `Accept: application/json`
- Body: none
- Success: `200`

## Auth

### POST Register

- URL: `{{base_url}}{{api_prefix}}/auth/register`
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
- Body:

```json
{
  "email": "person@example.com",
  "password": "StrongPassword123!"
}
```

### POST Admin Login

- URL: `{{base_url}}{{api_prefix}}/auth/admin/login`
- Body: same as login.

### POST Refresh

- URL: `{{base_url}}{{api_prefix}}/auth/refresh`
- Body:

```json
{
  "refreshToken": "{{refresh_token}}"
}
```

### POST Logout

- URL: `{{base_url}}{{api_prefix}}/auth/logout`
- Headers: `Authorization: Bearer {{access_token}}`

### GET Me

- URL: `{{base_url}}{{api_prefix}}/auth/me`
- Headers: `Authorization: Bearer {{access_token}}`

## Sessions

### POST Anonymous Session

- URL: `{{base_url}}{{api_prefix}}/sessions/anonymous`
- Body:

```json
{
  "language": "en",
  "jurisdiction": "NSW",
  "safetyGateAccepted": true
}
```

### GET Current Session

- URL: `{{base_url}}{{api_prefix}}/sessions/current`
- Headers: `X-SafeSpeak-Session: {{anonymous_session_token}}`

### POST Convert To User

- URL: `{{base_url}}{{api_prefix}}/sessions/convert-to-user`
- Headers: `X-SafeSpeak-Session: {{anonymous_session_token}}`
- Body:

```json
{
  "userId": "000000000000000000000000"
}
```

## Consent

Protected by either `Authorization` or `X-SafeSpeak-Session`.

### GET Current Consent

- URL: `{{base_url}}{{api_prefix}}/consents/current`

### POST Update Consent

- URL: `{{base_url}}{{api_prefix}}/consents/update`
- Body:

```json
{
  "flags": {
    "cloud_sync": true,
    "process_with_ai": false,
    "use_anonymised_analytics": true
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

## Profile

### GET Profile

- URL: `{{base_url}}{{api_prefix}}/profile`

### PATCH Profile

- URL: `{{base_url}}{{api_prefix}}/profile`
- Body:

```json
{
  "preferredLanguage": "en",
  "jurisdiction": "NSW",
  "referralSharingPreference": false,
  "accessibilityPreferences": {}
}
```

### GET Languages

- URL: `{{base_url}}{{api_prefix}}/languages`

### GET Cultural Profiles

- URL: `{{base_url}}{{api_prefix}}/cultural-profiles`

### GET Faith Profiles

- URL: `{{base_url}}{{api_prefix}}/faith-profiles`

### GET Community Profiles

- URL: `{{base_url}}{{api_prefix}}/community-profiles`

## Reports

Protected by either `Authorization` or `X-SafeSpeak-Session`.

### POST Create Report

- URL: `{{base_url}}{{api_prefix}}/reports`
- Body:

```json
{
  "language": "en",
  "jurisdiction": "NSW",
  "context": "Information the user consented to store.",
  "originalNarrative": "Only stored when cloud_sync consent is true.",
  "incidentType": "online_abuse",
  "severity": "medium",
  "structuredFields": {
    "what": "Example description"
  }
}
```

### GET Reports

- URL: `{{base_url}}{{api_prefix}}/reports`

### GET Report By ID

- URL: `{{base_url}}{{api_prefix}}/reports/:id`

### PATCH Report

- URL: `{{base_url}}{{api_prefix}}/reports/:id`

### DELETE Report

- URL: `{{base_url}}{{api_prefix}}/reports/:id`

### POST Mark Information-Only

- URL: `{{base_url}}{{api_prefix}}/reports/:id/mark-info-only`

### POST Withdraw

- URL: `{{base_url}}{{api_prefix}}/reports/:id/withdraw`

### POST Request Delete

- URL: `{{base_url}}{{api_prefix}}/reports/:id/request-delete`

### GET Status

- URL: `{{base_url}}{{api_prefix}}/reports/:id/status`

### GET Timeline

- URL: `{{base_url}}{{api_prefix}}/reports/:id/timeline`

## Response Examples

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

## Future Module Folders

Health, Auth, Sessions, Consent, Profile, Reports, Evidence, AI, RAG, ScamShield, Support, Education, Admin, Analytics, Privacy, Audit.
