# SafeSpeak Conversation-First Implementation Plan

Date: 16 May 2026

## Current-State Assessment

### Backend

Status: partially implemented, not correct for the required product flow

What already exists:

- Anonymous session support
- AI timeline assistant endpoint
- AI triage endpoint
- RAG knowledge source management
- Support service CRUD and recommendation endpoint

What is missing or incorrect:

- No dedicated persisted conversation-flow domain for session, messages, fact extraction, triage state, and recommendation state
- Triage is still report-shaped and narrative-first instead of conversation-session-first
- Triage contract does not expose the required `likelyCategory`, `safetyRiskLevel`, `reasoningSummary`, `matchedLegislationIds`, `matchedKnowledgeSources`, `humanReviewRecommended`, and `canProceedToRecommendations` flow fields
- Recommendation logic is still mostly generic support-service filtering by `needs`
- Recommendation results are not sufficiently validated against issue type, safety level, jurisdiction, and resource type
- No backend-managed transition state from conversation -> triage -> recommendations -> details -> optional report submission
- No reliable backend persistence for background timeline/fact extraction from conversation turns

### Admin Dashboard

Status: partially implemented, not correct for the required resource/legislation management flow

What already exists:

- Support service management page
- Warm referral activity
- Knowledge source management page
- Content resource and media management

What is missing or incorrect:

- Support service schema is broader directory data, not a triage-resource data model
- No dedicated admin resource type taxonomy matching the required categories
- No simple category -> resource type -> legislation tag mapping workflow
- Existing tables do not provide the exact filters required for issue-specific recommendation management
- No clear distinction between user-facing recommendation resources and general content assets

### Frontend

Status: not correct for the required conversation-first experience

What already exists:

- Assistant conversation page
- Triage explanation page
- Recommendation page
- Detailed explanation/report flow screens

What is missing or incorrect:

- Visible live timeline builder is still shown
- Chat entry still contains static topic/action patterns
- Transition still points toward report submission too early
- Recommendation screen is still static and can show mismatched cards
- Triage and details screens are not fully driven by a stable backend flow contract
- Mock fallback is not aligned to a shared conversation-flow DTO

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
