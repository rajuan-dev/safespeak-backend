# SafeSpeak Frontend Required Implementation Plan

Date: 17 May 2026

Implementation status: Steps 1, 2, 3, 4, 5, 6, 7, 8, and 9 implemented on 17 May 2026. Continue with Step 10 next.

Primary scope: `safespeak-frontend`

Secondary scope when required: `safespeak-backend` API contract updates for public analytics and privacy self-service gaps.

## Current-State Scan

Frontend routes and shells already exist for many of the expected surfaces, but several are incomplete or do not expose the backend capabilities.

Observed frontend gaps:

- `src/lib/reports-client.ts` supports create/update/list/get/status/timeline/destination preview/submission, but not withdraw, delete, request-delete, or mark-info-only.
- `src/lib/evidence-client.ts` supports upload, complete upload, get evidence, and transcription, but not metadata, hash verification, audit chain, delete, or transcription fetch.
- `src/lib/assistant-conversation.ts`, `src/lib/conversation-flow.ts`, and `src/lib/voice-transcription.ts` call `grantConsent` inside API clients, which can silently enable `process_with_ai` or `transcribe_audio`.
- `src/components/dashboard/dashboard-report-submission-pages/report-submission-review-page.tsx` submits destination reports with `confirmConsent: true`, but does not clearly gate the action on explicit `share_with_agencies` consent first.
- `src/lib/support-client.ts` already has advocate request and safety-plan client support, but explorer/service-detail UI mostly exposes discovery and counts.
- `src/app/guestbook/page.tsx` and `src/app/admin/page.tsx` are public frontend routes that should be removed or redirected.

## Implementation Rules

- Do not call AI, RAG, transcription, external sharing, cloud evidence, report storage, warm referral, or analytics opt-in endpoints before the matching explicit user consent is present.
- API clients should use `ensureConsent` and throw `ConsentRequiredError`; UI components should render an explicit consent gate and call `grantConsent` only from a clear user action.
- Do not auto-save server-side reports or evidence before `cloud_sync=true`.
- Do not submit or share externally before `share_with_agencies=true`.
- AI triage must only suggest next steps and contact options. It must not automatically send emails, make phone calls, or notify police/government/support services; the user must choose each outreach action.
- Do not use admin-only analytics endpoints from the public frontend.
- All AI and legal-aware responses remain information-only and render backend disclaimers, confidence, citations, fallback reason, and human-review state when present.
- Keep local-only fallback states clearly labelled.

## One-By-One Implementation Order

1. Consent and client foundation
2. Report lifecycle controls
3. Evidence verification and audit-chain workflows
4. General report submission consent
5. AI and transcription consent consistency
6. RAG/source Q&A and AI report helper tools
7. Advocate request and safety-plan workflows
8. Local Intelligence real public experience
9. Data export and deletion self-service
10. Remove or redirect non-product public routes
11. End-to-end verification pass

## Step 1: Consent And Client Foundation

Status: implemented in `safespeak-frontend` on 17 May 2026.

Expected impact: all later work can reuse the same consent and error handling patterns.

Files to update:

- `safespeak-frontend/src/lib/consent.ts`
- `safespeak-frontend/src/components/consent/consent-required-card.tsx`
- API clients under `safespeak-frontend/src/lib`
- Dashboard pages that call protected actions

Tasks:

- [x] Add a small reusable UI helper or hook for consent-gated actions if one does not already exist. It should catch `ConsentRequiredError`, render the requirement text, and call `grantConsent` only when the user presses the allow button.
- [x] Standardize API clients so they call `ensureConsent` rather than `grantConsent`.
- [x] Keep `grantConsent` calls in UI event handlers only.
- [x] Add source strings for any new consent moments, such as `report_destination_submit`, `source_backed_question`, `advocate_request`, `safety_plan_storage`, and `privacy_self_service`.
- [x] Confirm all consent-gated pages show a clear decline path and continue to support local-only or read-only fallback where appropriate.

Acceptance criteria:

- No API client silently grants consent.
- A user action is required before consent state changes.
- Existing settings consent toggles still work.
- Failed consent-gated actions show the same reusable consent UI pattern.

## Step 2: Report Lifecycle Controls

Status: implemented in `safespeak-frontend` on 17 May 2026.

Expected routes:

- `/dashboard/reports`
- `/dashboard/reports/[reportId]`
- `/dashboard?view=reportsubmissionhistory`

Backend endpoints:

- `GET /reports`
- `GET /reports/:id`
- `GET /reports/:id/status`
- `GET /reports/:id/timeline`
- `POST /reports/:id/withdraw`
- `DELETE /reports/:id`
- `POST /reports/:id/request-delete`
- `POST /reports/:id/mark-info-only`

Frontend files to update:

- `safespeak-frontend/src/lib/reports-client.ts`
- `safespeak-frontend/src/app/dashboard/reports/page.tsx`
- `safespeak-frontend/src/app/dashboard/reports/[reportId]/page.tsx`
- `safespeak-frontend/src/components/dashboard/dashboard-reports-pages.tsx`
- `safespeak-frontend/src/components/dashboard/dashboard-report-submission-pages/report-submission-history-page.tsx`

Tasks:

- [x] Add typed client methods: `withdrawReport`, `deleteReport`, `requestReportDelete`, and `markReportInfoOnly`.
- [x] Add lifecycle action availability helpers so the UI only shows valid actions for the current report status.
- [x] Update `/dashboard/reports` to show live reports, status, last updated time, SafeSpeak reference, and primary action links.
- [x] Update `/dashboard/reports/[reportId]` to show report details, status timeline, submission records if available, and lifecycle controls.
- [x] Update `reportsubmissionhistory` to reuse live report history instead of acting only as a flow step.
- [x] Add confirmation dialogs for withdraw, delete, request delete, and mark info-only.
- [x] Refresh report detail and history after each lifecycle action.
- [x] Show backend errors with request context when an action is blocked by status.

Acceptance criteria:

- A user can withdraw an eligible report and sees the updated `withdrawn` status.
- A user can delete or request deletion through the backend endpoint and no longer sees the report as active.
- A user can mark a report information-only and sees that state reflected in history/detail.
- Invalid lifecycle actions are hidden or disabled with clear status copy.

## Step 3: Evidence Verification And Audit Chain

Status: implemented in `safespeak-frontend` with a small backend metadata/audit-chain access fix on 17 May 2026.

Expected route:

- `/dashboard?view=reportsubmissionevidence`

Backend endpoints:

- `POST /evidence/upload-url`
- `POST /evidence/complete-upload`
- `GET /evidence/:id`
- `GET /evidence/:id/metadata`
- `POST /evidence/:id/verify-hash`
- `GET /evidence/:id/audit-chain`
- `DELETE /evidence/:id`
- `POST /evidence/:id/transcribe`
- `GET /evidence/:id/transcription`

Frontend files to update:

- `safespeak-frontend/src/lib/evidence-client.ts`
- `safespeak-frontend/src/components/dashboard/dashboard-report-submission-pages/report-submission-evidence-page.tsx`
- Any shared evidence item/card components created during implementation

Tasks:

- [x] Add typed client methods: `getEvidenceMetadata`, `verifyEvidenceHash`, `getEvidenceAuditChain`, `deleteEvidence`, and `getEvidenceTranscription`.
- [x] Add evidence item detail state that can render metadata, upload status, storage status, SHA-256 hash, deletion request timestamp, and transcription status.
- [x] Add hash verification UI that lets the user paste or provide a computed SHA-256 and compares it through `POST /evidence/:id/verify-hash`.
- [x] Add an audit-chain panel showing upload, complete, verify, transcribe, delete-request, and delete events returned by the backend.
- [x] Add delete evidence action with confirmation and post-delete refresh.
- [x] Keep upload gated by `cloud_sync`; keep transcription gated by `transcribe_audio` or `process_with_ai`.
- [x] Label local-only evidence clearly when cloud sync is declined.

Acceptance criteria:

- Uploaded evidence shows backend metadata and hash.
- Hash verification displays match/mismatch status from the backend.
- Audit-chain entries are visible per evidence item.
- Evidence deletion calls the backend and updates the UI.
- Transcription cannot start without explicit transcription or AI consent.

## Step 4: General Report Submission Consent

Status: implemented in `safespeak-frontend` on 17 May 2026.

Expected route:

- `/dashboard?view=reportsubmissionreview`

Backend endpoints:

- `GET /reports/:id/destinations`
- `POST /reports/:id/submission-previews`
- `POST /reports/:id/submissions`

Frontend files to update:

- `safespeak-frontend/src/lib/reports-client.ts`
- `safespeak-frontend/src/components/dashboard/dashboard-report-submission-pages/report-submission-review-page.tsx`
- `safespeak-frontend/src/components/consent/consent-required-card.tsx`

Tasks:

- [x] Require explicit `share_with_agencies=true` before `submitReportToDestination`.
- [x] Do not treat `confirmConsent: true` as sufficient unless frontend consent state is current.
- [x] Render destination-specific consent requirements from `requiredConsentFlags` and `missingConsentFlags`.
- [x] Add a visible consent gate before the final submit action.
- [x] For multi-destination selection, block submit until all selected destinations have their required consent flags.
- [x] Preserve ScamShield's existing explicit sharing consent behavior and align the general report flow to it.
- [x] Make police/government/support phone and email contact actions user-initiated; SafeSpeak does not call, email, or notify automatically.

Acceptance criteria:

- General report submission cannot call `POST /reports/:id/submissions` before `share_with_agencies=true`.
- A user can decline sharing and keep the report prepared but unsubmitted.
- Submission preview remains available without sending externally.
- Destination missing consent state is clearly displayed.

## Step 5: AI And Transcription Consent Consistency

Status: implemented in `safespeak-frontend` on 17 May 2026.

Expected routes:

- `/dashboard?view=assistant`
- `/dashboard?view=assistantconversation`
- Evidence transcription screens under `/dashboard?view=reportsubmissionevidence`

Backend endpoints:

- `POST /rag/timeline-assistant`
- Conversation-flow endpoints under `/conversation-flow`
- `POST /ai/transcribe-audio`
- `POST /evidence/:id/transcribe`

Frontend files to update:

- `safespeak-frontend/src/lib/assistant-conversation.ts`
- `safespeak-frontend/src/lib/conversation-flow.ts`
- `safespeak-frontend/src/lib/voice-transcription.ts`
- `safespeak-frontend/src/components/dashboard/dashboard-assistant-pages.tsx`
- `safespeak-frontend/src/components/dashboard/assistant-interaction.tsx`
- `safespeak-frontend/src/components/dashboard/dashboard-report-submission-pages/report-submission-evidence-page.tsx`

Tasks:

- [x] Replace client-side `grantConsent({ process_with_ai: true })` with `ensureConsent(consentRequirements.aiAssistant)`.
- [x] Replace client-side `grantConsent({ transcribe_audio: true })` with `ensureConsent(consentRequirements.audioTranscription)`.
- [x] Ensure assistant page catches `ConsentRequiredError` before creating sessions, appending messages, fetching triage, or fetching recommendations/details.
- [x] Ensure voice transcription asks for consent before creating or uploading a recording.
- [x] Confirm evidence transcription uses the explicit evidence transcription consent gate and does not start automatically after upload.
- [x] Add regression checks that no AI or transcription network request fires on initial page mount.

Acceptance criteria:

- Assistant chat cannot send to AI before explicit `process_with_ai` consent.
- Conversation-flow session creation and message append do not silently grant consent.
- Voice transcription cannot call `/ai/transcribe-audio` before explicit consent.
- Evidence transcription cannot call `/evidence/:id/transcribe` before explicit consent.

## Step 6: RAG/Source Q&A And AI Report Helper Tools

Expected surface:

- Assistant flow
- Report drafting/review flow

Backend endpoints:

- `POST /rag/search`
- `POST /rag/answer`
- `POST /ai/extract-incident-fields`
- `POST /ai/triage-report`
- `POST /ai/clarifying-questions`
- `POST /ai/generate-summary`
- `POST /ai/translate`
- `POST /ai/redact-pii`

Frontend files to update:

- Add or extend `safespeak-frontend/src/lib/ai-client.ts`
- Add or extend `safespeak-frontend/src/lib/rag-client.ts`
- `safespeak-frontend/src/components/dashboard/dashboard-assistant-pages.tsx`
- `safespeak-frontend/src/components/dashboard/assistant-interaction.tsx`
- `safespeak-frontend/src/components/dashboard/dashboard-report-submission-pages/report-submission-details-page.tsx`
- `safespeak-frontend/src/components/dashboard/dashboard-report-submission-pages/report-submission-review-page.tsx`

Tasks:

- [x] Add typed RAG client methods for source search and source-backed answer.
- [x] Add typed AI helper client methods for extraction, triage, clarifying questions, summary, translation, and PII redaction.
- [x] Add a source-backed Q&A panel in the assistant/report helper flow, gated by `process_with_ai`.
- [x] Render answer citations with title, publisher, URL, jurisdiction, source category/type/topic, and update date when returned.
- [x] Render insufficient-source fallback without fake citations.
- [x] Add report drafting helper actions: extract fields, ask clarifying questions, generate summary, translate, and redact PII.
- [x] Require user review before any AI-generated field is written into the report draft.
- [x] Keep AI output information-only and show backend disclaimer/human-review state.

Acceptance criteria:

- User can ask a source-backed question and see approved-source citations or a no-source fallback.
- User can run AI report helpers only after explicit AI consent.
- AI helper output is previewed and editable before updating the draft.
- Legal-aware answers never show hard-coded legal conclusions without backend citations.

## Step 7: Advocate Request And Safety-Plan Workflows

Expected routes:

- `/dashboard/explorer`
- `/dashboard/explorer/service-details`

Backend endpoints:

- `GET /support/services`
- `GET /support/services/:id`
- `POST /support/recommendations`
- `GET /support/advocates`
- `POST /support/advocate-request`
- `GET /support/safety-plans`
- `POST /support/safety-plans`
- `PATCH /support/safety-plans/:id`
- `POST /support/warm-referral`

Frontend files to update:

- `safespeak-frontend/src/lib/support-client.ts`
- `safespeak-frontend/src/components/dashboard/dashboard-explorer-page.tsx`
- `safespeak-frontend/src/components/dashboard/dashboard-explorer-service-details-page.tsx`
- `safespeak-frontend/src/components/dashboard/dashboard-safety-pages.tsx`

Tasks:

- [x] Add an advocate matching section with filters for language, issue type, location/region, and availability when returned.
- [x] Add a request advocate form with selected advocate type, language, notes, safe contact preference, and confirmation copy.
- [x] Gate advocate contact/request flows with `warm_referral` consent unless a more specific backend consent flag is added.
- [x] Show exactly what fields will be shared before creating an advocate request or warm referral.
- [x] Add safety-plan list, create, and edit UI backed by `/support/safety-plans`.
- [x] Keep safety-plan forms structured around trusted contacts, safe places, warning signs, coping strategies, emergency steps, and active status.
- [x] Keep emergency guidance visible on safety planning screens.

Acceptance criteria:

- User can view advocates and submit a consented advocate request.
- User can create and update a safety plan through the backend.
- User sees a preview of shared fields before advocate/warm referral submission.
- Declining consent leaves service discovery available without creating a request.

## Step 8: Local Intelligence Real Public Experience

Expected route:

- `/dashboard?view=localintelligence`

Backend dependency:

- Current analytics routes are admin-only under `/admin/analytics`.
- The public frontend should not call admin analytics routes.
- Add or confirm a public threshold-safe endpoint before replacing the placeholder, such as `GET /analytics/public/local-intelligence` or `GET /local-intelligence`.

Frontend files to update:

- `safespeak-frontend/src/components/dashboard/dashboard-home-screen.tsx`
- The component currently used for the `localintelligence` view
- Add `safespeak-frontend/src/lib/local-intelligence-client.ts`

Tasks:

- [x] Confirm backend public aggregate endpoint and response contract.
- [x] If missing, add a backend public endpoint that only returns threshold-protected aggregates from consented reports.
- [x] Enforce suppression for cells below the configured threshold.
- [x] Render area/category/time trend cards only from aggregate data.
- [x] Show suppressed/insufficient data states without implying exact counts.
- [x] Add filters for jurisdiction, LGA/region, timeframe, and category only if the backend confirms safe aggregate output.
- [x] Keep copy information-only and avoid implying case management, emergency response, or real-time monitoring.

Acceptance criteria:

- Local Intelligence uses live threshold-safe aggregate data or an explicit insufficient-data state.
- No raw reports, PII, exact low counts, or admin-only data are exposed.
- Suppressed cells are labelled as privacy protected.
- The placeholder copy is removed once the public endpoint is available.

## Step 9: Data Export And Deletion Self-Service

Current routes:

- `/dashboard/settings`
- `/profile`

Backend dependency:

- Admin privacy request queue exists.
- Public self-service creation/status/export endpoints must be confirmed or added before the frontend can be complete.

Potential backend endpoints to add or confirm:

- `POST /privacy-requests`
- `GET /privacy-requests/me`
- `GET /privacy-requests/:id`
- `GET /privacy/export`
- `POST /privacy/delete-request`
- `POST /auth/deactivate` or equivalent account deactivation endpoint

Frontend files to update:

- `safespeak-frontend/src/components/dashboard/dashboard-settings-pages.tsx`
- `safespeak-frontend/src/app/profile/page.tsx`
- Add `safespeak-frontend/src/lib/privacy-client.ts`

Tasks:

- [x] Replace settings placeholder with real export, deletion request, and request status UI.
- [x] Replace profile local/session JSON download with backend export when authenticated or session-backed data exists.
- [x] Add delete request flow with confirmation, status, expected next steps, and audit/request reference.
- [x] Add account/session deactivation only when the backend supports a real status change.
- [x] Make anonymous/session user behavior clear: local-only data can be cleared locally, server data needs a backend request.
- [x] Keep irreversible actions behind explicit confirmation.

Acceptance criteria:

- User can request or download a backend-generated data export.
- User can request deletion and see request status/reference.
- Profile download no longer pretends local/session data is a full backend export.
- Deactivate either performs a real backend action or is not shown.

## Step 10: Remove Or Redirect Non-Product Public Routes

Routes:

- `/guestbook`
- `/admin`

Frontend files to update:

- `safespeak-frontend/src/app/guestbook/page.tsx`
- `safespeak-frontend/src/app/admin/page.tsx`
- `safespeak-frontend/src/components/app-navbar/index.tsx`
- Any links/tests that reference these routes

Tasks:

- [ ] Remove `/guestbook` from public navigation.
- [ ] Delete the guestbook route or redirect it to `/`.
- [ ] Replace `/admin` with a redirect to the real separate admin app URL when configured, or to `/login`/`/` with clear safe fallback.
- [ ] Remove frontend-only admin shell copy that duplicates `safespeak-admin`.
- [ ] Update tests and docs that still mention the frontend guestbook/admin routes.

Acceptance criteria:

- `/guestbook` no longer exposes a demo feature.
- `/admin` no longer presents a duplicate admin concept in the public frontend.
- Public navigation contains product routes only.

## Step 11: Verification Pass

Run after each completed workstream and again after the full sequence.

Frontend commands:

```bash
cd safespeak-frontend
npm run lint
npm run build
```

Backend commands, only when backend contracts are changed:

```bash
cd safespeak-backend
npm run typecheck
npm run build
```

Manual browser checks:

- [ ] `/dashboard/reports`
- [ ] `/dashboard/reports/[reportId]`
- [ ] `/dashboard?view=reportsubmissionhistory`
- [ ] `/dashboard?view=reportsubmissionevidence`
- [ ] `/dashboard?view=reportsubmissionreview`
- [ ] `/dashboard?view=assistant`
- [ ] `/dashboard?view=assistantconversation`
- [ ] `/dashboard/explorer`
- [ ] `/dashboard/explorer/service-details`
- [ ] `/dashboard?view=localintelligence`
- [ ] `/dashboard/settings`
- [ ] `/profile`
- [ ] `/guestbook`
- [ ] `/admin`

Regression checks:

- [ ] No AI/transcription endpoint is called on route mount before consent.
- [ ] No external submission endpoint is called before `share_with_agencies=true`.
- [ ] No report/evidence cloud write happens before `cloud_sync=true`.
- [ ] Local-only states remain usable and clearly labelled.
- [ ] Public Local Intelligence never reveals low-count or raw report data.
- [ ] Lifecycle, evidence, privacy, and support actions refresh UI state after backend mutation.
