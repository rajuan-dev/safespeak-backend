# SafeSpeak Conversation-First Implementation Plan

Date: 16 May 2026

Implementation status: implemented and verified on 16 May 2026.

## Current-State Assessment

### Backend

Status: implemented for the conversation-first flow

What already exists:

- Anonymous session support
- AI timeline assistant endpoint
- AI triage endpoint
- RAG knowledge source management
- Support service CRUD and recommendation endpoint
- Dedicated conversation-flow APIs for sessions, messages, fact extraction, triage, recommendations, and details

What was fixed:

- Added persisted conversation sessions, messages, fact extraction, and triage snapshots
- Added conversation-first triage contract with `likelyCategory`, `safetyRiskLevel`, `reasoningSummary`, `matchedLegislationIds`, `matchedKnowledgeSources`, `humanReviewRecommended`, and `canProceedToRecommendations`
- Added backend-managed transition state from conversation to triage, recommendations, details, and optional report submission
- Added issue/risk/resource filtering for recommendations using admin-managed support resources
- Added knowledge/legislation matching using approved RAG knowledge sources

### Admin Dashboard

Status: implemented for resource and knowledge management

What already exists:

- Support service management page
- Warm referral activity
- Knowledge source management page
- Content resource and media management

What was fixed:

- Support service schema includes resource type, issue types, risk levels, CTA label, priority, safety notes, eligibility notes, and language support notes
- Admin support-service UI includes filters for resource type, issue type, jurisdiction, and status
- Knowledge source management is reused for legislation and approved source grounding
- Category/resource/risk mapping is implemented through backend rules plus admin-managed resource metadata

### Frontend

Status: implemented for the conversation-first experience

What already exists:

- Assistant conversation page
- Triage explanation page
- Recommendation page
- Detailed explanation/report flow screens

What was fixed:

- Visible live timeline builder is hidden from the user-facing chat screen
- Timeline/fact extraction stays in internal state and backend payloads
- Conversation transition now points to triage/options, not direct report submission
- Triage, recommendations, and details screens consume the shared conversation-flow DTOs
- Recommendations are backend/admin-resource driven, with safe fallback if live endpoints are unavailable
- The large background sphere is removed from the active chat screen

## Implementation Order

1. Scan existing codebase and confirm gaps
2. Fix backend contract and persistence first
3. Add/fix admin resource and legislation management
4. Update frontend flow to consume the new contract
5. Add mock fallback and run integration checks

## Planned Deliverables

### Backend

- New conversation-flow domain with:
  - conversation session record
  - conversation messages
  - extracted timeline/facts
  - triage result snapshot
- New APIs for:
  - create/get session
  - append conversation turn
  - get triage result
  - get recommendations
  - get detailed rights/evidence/reporting view
- Rule-based category validation and resource filtering on top of AI-extracted context
- Knowledge/legislation matching metadata included in triage and details responses

### Admin

- Resource management aligned to:
  - category
  - jurisdiction
  - resource type
  - priority
  - active status
- Legislation/knowledge management reused from existing RAG admin
- Simple mapping/rules storage for:
  - category -> resource types
  - category -> legislation tags
  - safety risk -> emergency resources

### Frontend

- Hide live timeline builder from user chat UI
- Keep timeline extraction in the background
- Move conversation to triage after enough useful turns
- Rename report-first CTAs to triage/options-first CTAs
- Drive triage/recommendations/details screens from backend DTOs
- Use a mock fallback only when backend flow endpoints are unavailable

## Acceptance Criteria

- User can start with AI conversation
- Background facts build without visible timeline panel
- Triage can differ from initial selected topic
- Recommendations are issue-specific and resource-managed
- Legal/context explanation comes from approved knowledge data or falls back safely
- Admin can manage resources and knowledge used by triage/recommendations
- Frontend/backend contracts are documented and typed

## Verification

- `safespeak-backend`: `npm run typecheck`
- `safespeak-admin`: `npm run build`
- `safespeak-frontend`: `npm run build`
