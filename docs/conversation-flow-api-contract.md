# SafeSpeak Conversation Flow API Contract

Date: 16 May 2026

This contract supports the product flow:

Report Incident / AI Conversation -> Background Timeline Building -> Triage / Classification -> Dynamic Recommendations -> Detailed Explanation / Rights / Evidence / Reporting Options -> Optional Report Submission

## Session

`POST /conversation-flow/sessions`

Request:

```json
{
  "selectedTopic": "racial_abuse",
  "jurisdiction": "NSW",
  "location": "Sydney"
}
```

Response:

```json
{
  "session": {
    "id": "session-id",
    "selectedTopic": "racial_abuse",
    "detectedCategory": "racism_discrimination",
    "status": "active",
    "safetyRiskLevel": "low",
    "jurisdiction": "NSW",
    "location": "Sydney",
    "messageCount": 0,
    "userTurnCount": 0
  }
}
```

## Conversation Turn

`POST /conversation-flow/sessions/:id/messages`

Request:

```json
{
  "content": "Someone pulled my hijab.",
  "language": "en"
}
```

Response shape:

```json
{
  "session": {},
  "userMessage": {},
  "assistantMessage": {},
  "factExtraction": {
    "whatHappened": "string",
    "whenHappened": "string",
    "whereHappened": "string",
    "peopleInvolved": "string",
    "safetyConcerns": "string",
    "evidenceMentioned": "string",
    "emotionalState": "string",
    "extractedEvents": ["string"],
    "missingInformation": ["string"],
    "timeline": {}
  },
  "triage": {},
  "transition": {
    "offerTriage": true,
    "prompt": "Plain English transition prompt",
    "primaryCta": "Continue to Triage",
    "secondaryCta": "Review my options"
  },
  "responseMeta": {
    "confidence": "medium",
    "disclaimer": "This is information only, not legal advice.",
    "citations": [],
    "rag": {
      "used": true,
      "unavailable": false,
      "resultCount": 2
    },
    "reviewStatus": "approved"
  }
}
```

The timeline is internal. It should not be shown on the user-facing chat screen.

## Triage

`GET /conversation-flow/sessions/:id/triage`

Response shape:

```json
{
  "session": {},
  "triage": {
    "likelyCategory": "racism_discrimination",
    "likelyCategoryLabel": "Racism or discrimination",
    "confidenceScore": 0.78,
    "confidenceLabel": "medium",
    "safetyRiskLevel": "medium",
    "reasoningSummary": "Plain-English summary grounded in conversation facts.",
    "matchedLegislationIds": ["source-id"],
    "matchedKnowledgeSources": [],
    "humanReviewRecommended": false,
    "missingInformation": [],
    "canProceedToRecommendations": true,
    "matchedResourceTypes": ["police", "anti_discrimination_body", "mental_health"],
    "disclaimer": "This is information only, not legal advice."
  }
}
```

## Recommendations

`GET /conversation-flow/sessions/:id/recommendations`

Recommendations are filtered by category, jurisdiction, risk level, resource type, active state, and priority.

```json
{
  "session": {},
  "recommendations": [
    {
      "id": "resource-id",
      "title": "Anti-discrimination support",
      "description": "Support for reporting discrimination or racial abuse.",
      "category": "racism_discrimination",
      "resourceType": "anti_discrimination_body",
      "ctaLabel": "View support",
      "phone": "string",
      "websiteUrl": "https://example.com",
      "priority": 90,
      "jurisdiction": "NSW",
      "safetyNotes": "string",
      "eligibilityNotes": "string",
      "languageSupportNotes": "string",
      "active": true
    }
  ],
  "fallbackUsed": false
}
```

## Details

`GET /conversation-flow/sessions/:id/details`

Response sections:

- `overview`
- `rights`
- `reportingOptions`
- `evidenceGuide`
- `supportServices`
- `safetyPlanning`

The details response must use approved knowledge sources when available and avoid invented legal claims when source matching is weak or unavailable.
