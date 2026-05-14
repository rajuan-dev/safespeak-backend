# SafeSpeak Implementation Roadmap

This roadmap breaks the full SafeSpeak requirements into incremental tasks that keep the backend, admin dashboard, and user frontend aligned. SafeSpeak remains an information-only triage and intelligence platform, not a crisis service, legal service, counselling service, case manager, or automatic reporting service.

## Current Architecture Snapshot

- Backend: Express, TypeScript, MongoDB, module-based APIs under `/api/v1`.
- Frontend: Next.js user app using public API clients and local-first dashboard flows.
- Admin: Vite React dashboard using protected admin API clients.
- Existing backend modules: auth, sessions, consent, profile, reports, evidence, AI/RAG, ScamShield, support, analytics, microeducation, content resources, media assets, resources, admin, RBAC scope.
- Existing admin management areas: taxonomies, destinations, submission templates, content resources, micro-education cards, knowledge sources, media assets, analytics, users, audit logs.

## Global Non-Negotiables

- Every sensitive flow begins with emergency guidance: `If you are in immediate danger, call 000 now. If it is safe, contact 1800RESPECT (24/7).`
- All AI and legal-aware copy must be information-only and clearly not legal advice.
- No automatic reporting to police, agencies, partners, or services.
- No auto-save by default and no storage before explicit consent.
- No background tracking, fingerprinting, covert location logging, or hidden telemetry.
- PII retention must be consented, minimal, auditable, and deletable.
- Admin controls must be the source of truth for configurable content, taxonomies, destinations, language/cultural options, and operational policies.
- Public analytics must be aggregated, threshold-protected, and privacy-preserving.

## Cross-System Dependency Rules

For each feature, implement in this order:

1. Backend model, schema, service, controller, routes, audit events.
2. API contract types and `docs/frontend-admin-api-contract.md` update.
3. Admin dashboard management UI and role gates.
4. Frontend public/user flow integration.
5. Consent, permission, safety, and copy checks.
6. Responsive UI pass.
7. Build, typecheck, and integration validation.

## Phase 0: Contract And Safety Baseline

### Task 0.1 Safety copy registry

- Backend: add central configurable safety/disclaimer settings if not already covered by content modules.
- Admin: create or extend a safety copy management panel for emergency prompt, information-only disclaimer, AI disclaimer, consent language, and quick-exit copy.
- Frontend: consume the safety copy from API with safe defaults.
- Validation: every safety-sensitive route displays the required 000 and 1800RESPECT copy.

### Task 0.2 Consent contract audit

- Backend: verify all write APIs require consent flags where storage, analytics, AI processing, cloud sync, or external sharing occurs.
- Admin: expose consent policy settings as read-only or editable depending on role.
- Frontend: block capture/save/share until the required consent state exists.
- Validation: no report/evidence/cloud/analytics write succeeds without required consent.

### Task 0.3 API envelope and error consistency

- Backend: confirm all modules use the standard success/error envelope.
- Admin/frontend: normalize API clients around requestId, errors, and messages.
- Validation: contract tests for representative public and admin endpoints.

## Phase 1: Admin As Source Of Truth

### Task 1.1 Taxonomies

- Backend: maintain incident types, support needs, language, culture/faith, scam categories, destination labels.
- Admin: create/update/archive taxonomy records.
- Frontend: replace hardcoded category/filter lists with taxonomy API data.
- Validation: editing taxonomy in admin updates frontend selectable categories.

### Task 1.2 Language and cultural profile management

- Backend: add or complete language/cultural profile models with active status, labels, scripts, and fallback behavior.
- Admin: manage supported languages, cultural/faith sensitivity profiles, translated labels.
- Frontend: onboarding/profile flows consume admin-managed options.
- Validation: inactive language/profile does not appear to users.

### Task 1.3 Safety and content settings

- Backend: versioned content settings for disclaimers, quick exit, covert mode instructions, emergency guidance.
- Admin: content admin can edit; super admin can approve/publish.
- Frontend: uses published content only.
- Validation: draft admin changes are not visible until published.

## Phase 2: Safety Gate, Consent, Quick Exit

### Task 2.1 Safety gate hardening

- Backend: persist acknowledgement only after explicit continue action.
- Frontend: gate appears on app open and before first sensitive capture.
- Admin: manage gate text and emergency links.
- Validation: direct deep links to capture/report routes still show gate first.

### Task 2.2 Quick Exit and covert mode

- Backend: no storage required for quick exit; optional policy settings only.
- Frontend: clear unsaved in-memory inputs, switch to neutral route, keep masked mode support.
- Admin: manage covert-mode instructions and neutral-route copy.
- Validation: quick exit is visible on every safety-sensitive screen.

### Task 2.3 Local-first save semantics

- Backend: cloud persistence only after consent.
- Frontend: local draft controls are explicit; no automatic remote save.
- Admin: policy copy and retention settings visible.
- Validation: network calls are not made while user is pre-consent.

## Phase 3: Evidence Vault And Incident Builder

### Task 3.1 Evidence asset contract

- Backend: ensure evidence upload supports text, audio, image, video, PDF/doc, screenshot, pasted content, hash, consent flags, audit log.
- Frontend: one reusable evidence picker/uploader component across report and ScamShield flows.
- Admin: no raw evidence browsing unless explicit consent and role/audit reason exist.
- Validation: every asset has SHA-256, timestamp, type, and consent metadata.

### Task 3.2 Incident builder

- Backend: report structured fields and timeline schema; AI extraction endpoint returns editable draft only.
- Frontend: narrative once, editable timeline, structured field review.
- Admin: manage extraction field definitions and destination mappings.
- Validation: user can edit every AI-extracted field before submit.

### Task 3.3 Offline queue

- Backend: idempotent upload/report endpoints.
- Frontend: local queue with explicit sync consent and retry states.
- Admin: no extra controls initially; observability only.
- Validation: queued evidence syncs once after reconnect and consent.

## Phase 4: AI Legal-Aware Triage And RAG

### Task 4.1 Official source governance

- Backend: RAG knowledge source approval, ingestion, refresh, and reindexing.
- Backend: enforce official source URLs, publisher, licence status, source update dates, refresh dates, legal review, approval separation, stale-source exclusion, ingestion, refresh hash checks, and reindexing.
- Admin: manage official sources, jurisdiction/topic/source type metadata, approval state, legal review state, licence notes, update dates, refresh schedule, due-refresh queue, stale-source exclusions, and official URL refresh actions.
- Frontend: only use approved/published explanations from approved current RAG sources.
- Validation: unapproved, stale, rejected, archived, metadata-only, or non-legally-reviewed legal source content never appears in AI answers.

### Task 4.1a Official source ingestion and refresh workflow

- Backend: `POST /rag/knowledge-sources/:id/refresh` fetches readable official HTML/text, stores PDFs/docs as metadata-only unless extracted text is supplied, updates `lastVerifiedAt`, `nextRefreshAt`, `ingestionStatus`, `sha256Hash`, and chunk count, and returns changed official material to review.
- Admin: refresh action, due-refresh counters, stale-exclusion counters, needs-legal-review state, and ready-for-approval state on the knowledge-source page.
- Seed data: NSW-first starter official corpus for NSW discrimination/racial vilification plus AHRC, eSafety, OAIC, Scamwatch, and ACSC support context, all `pending_review` with `legalReviewed=false`.
- Validation: `/rag/answer` searches only approved, current, legally reviewed official legal sources and returns the insufficient-sources fallback when none are available; citations include title, publisher, URL, jurisdiction, source category/type/topic, and update date.

### Task 4.2 Information-only triage responses

- Backend: triage endpoint enforces disclaimer, normalizes output into an information-only envelope, blocks legal/clinical/crisis advice phrasing, and returns confidence, citations, fallback reason, safety flags, and human-review state.
- Admin: manage AI triage system prompt, response template, fallback text, and template status through draft/publish platform settings.
- Frontend: display triage classification, explanation, disclaimer, confidence, fallback reason, citations, and human-review state.
- Validation: red-team prompts cannot produce legal, clinical, counselling, crisis-service, or case-management advice phrasing.

### Task 4.3 NSW-first legal awareness

- Backend: `/rag/answer` and `/rag/timeline-assistant` attach an NSW `legalAwareness` envelope for racial abuse and migrant challenge contexts, keep the response information-only, and retrieve NSW requests from approved NSW, Commonwealth, or Australian sources only.
- Backend: NSW legal-aware fallbacks return `sourceStatus=insufficient_approved_sources` and no citations when there are no approved, current, legally reviewed sources.
- Admin: legal awareness content remains governed by the official-source registry, approval state, legal review state, versioning, refresh status, and stale-source exclusion rules from Tasks 4.1 and 4.1a.
- Frontend: racial abuse and migrant challenge assistant flows show NSW legal-awareness pathway cards, source status, source policy, confidence, human-review state, and citations returned by the backend.
- Validation: every legal-aware screen states information-only; detailed legal explanations and citations appear only from approved, current, legally reviewed sources.

## Phase 5: Report And Route Engine

### Task 5.1 Destination registry

- Backend: destinations, channels, templates, required fields, anonymity options, expected next steps.
- Admin: CRUD for destinations and submission templates.
- Frontend: recommender displays reason, requirements, anonymity, and consent per destination.
- Validation: user sees destination preview before any send.

### Task 5.2 Single story to multi-destination mapping

- Backend: map structured report fields to destination templates.
- Admin: edit mappings per destination.
- Frontend: preview generated submissions for each selected destination.
- Validation: same report can generate multiple destination payloads without duplicate user entry.

### Task 5.3 Consent-based delivery

- Backend: delivery API/email fallback only runs after per-destination consent.
- Admin: monitor delivery status and templates, not raw PII unless allowed.
- Frontend: submit flow records SafeSpeak ref and external ref where available.
- Validation: no automatic forwarding; revoked consent blocks delivery.

## Phase 6: Support Ecosystem

### Task 6.1 Support/resource directory

- Backend: support-service registry model/API with categories, languages, regions, eligibility, profile tags, contact details, and booking links.
- Admin: CRUD directory entries and publishing/active state from the Crisis & Safety support-services page.
- Frontend: support navigator filters by profile/location/service type and renders registry detail fields.
- Validation: admin-published resource appears on frontend.

### Task 6.2 Warm referrals

- Backend: referral request model with minimal summary, included-field list, masked audit view, and consent snapshot.
- Admin: support-service partner metadata plus warm-referral audit/status monitoring.
- Frontend: user preview and consent before sharing summary.
- Validation: referral payload contains only allowed minimal fields.

### Task 6.3 Advocate matching

- Backend: advocate profiles, vetting status, availability, language, region, issue types.
- Admin: manage advocates and vetting.
- Frontend: match list and consented contact request.
- Validation: no personal contact details are shown without consent.

## Phase 7: ScamShield

### Task 7.1 Scam intake

- Backend: text, screenshot/OCR, email header, URL/entity extraction models.
- Frontend: paste/upload/forward UI with consent boundaries.
- Admin: manage scam taxonomies, red-flag copy, action templates.
- Validation: analysis can run locally/pre-consent where feasible; server processing requires consent.

### Task 7.2 Detection pipeline

- Backend: layered score, red flags, confidence, recommended actions.
- Admin: configure score thresholds and explanation templates.
- Frontend: plain-language result screen with Low/Medium/High bands.
- Validation: sample phishing inputs produce expected risk bands.

### Task 7.3 ACCC/ACSC pre-reporting

- Backend: report draft generation, no submission without consent.
- Admin: manage templates and routing metadata.
- Frontend: editable drafts and external guidance links.
- Validation: PII redaction option works before draft export/share.

## Phase 8: Micro-Education And Learning Content

### Task 8.1 Micro-education cards

- Backend: microeducation CRUD and public published list.
- Admin: create/update/delete/publish cards, filters, order, language variants.
- Frontend: Resource Library, MicroEducation grid, and MicroCards all consume backend APIs.
- Validation: admin-created published card appears in all relevant frontend views.

### Task 8.2 Downloadable educational resources

- Backend: content-resource upload, file storage, review date, status, download route.
- Admin: upload/edit/delete resources.
- Frontend: resource library consumes published resources.
- Validation: archived/draft resources do not appear to users.

### Task 8.3 Audio/PDF/share formats

- Backend: media assets linked to education content.
- Admin: manage audio narration, PDF links, shareable assets.
- Frontend: render per-format controls where available.
- Validation: missing media does not break cards.

## Phase 9: Analytics, Heatmaps, Intelligence

### Task 9.1 Aggregation pipeline

- Backend: aggregate by LGA/time/category, no raw PII in analytics tables.
- Admin: analytics dashboard with filters.
- Frontend: public-facing insights only if intended and privacy safe.
- Validation: cells below threshold are suppressed.

### Task 9.2 Differential privacy exports

- Backend: configurable threshold/noise settings and export metadata.
- Admin: export controls by role and MOU status.
- Frontend: none unless partner dashboard exists.
- Validation: exported CSV/JSON includes dp parameters and no raw PII.

### Task 9.3 Trust and impact metrics

- Backend: consented feedback/impact events.
- Admin: dashboard metrics.
- Frontend: user-facing impact statements must avoid promising case outcomes.
- Validation: analytics copy cannot imply case management.

## Phase 10: RBAC, Audit, And Governance

### Task 10.1 Role model alignment

- Backend: Super Admin, Content Admin, Integrations Admin, Analytics Viewer.
- Admin: route guards and action-level controls.
- Frontend: no admin-only data access.
- Validation: each role can access only permitted pages/actions.

### Task 10.2 Audit logging

- Backend: log admin actions and sensitive access attempts.
- Admin: audit log viewer with PII removed.
- Frontend: none.
- Validation: create/update/delete/admin exports produce audit entries.

### Task 10.3 Raw PII access policy

- Backend: reason-required access flow for consented raw data.
- Admin: gated request and audit reason UI.
- Frontend: consent display and withdrawal controls.
- Validation: admins cannot browse raw report/evidence data by default.

## Phase 11: Data Retention And Deletion

### Task 11.1 Retention policy engine

- Backend: retention windows for drafts, info-only reports, forwarded reports, evidence.
- Admin: manage policy values with approval.
- Frontend: show retention policy in consent and profile settings.
- Validation: scheduled deletion honors policy and exceptions.

### Task 11.2 Delete my data

- Backend: deletion pipeline for local/cloud/server records where allowed.
- Frontend: one-tap data deletion request.
- Admin: deletion request tracking without unnecessary PII exposure.
- Validation: deleted records are inaccessible and audit records remain minimal.

## Phase 12: UX, Accessibility, Localization

### Task 12.1 Design system consistency

- Admin/frontend: shared visual rules for buttons, forms, cards, alerts, safety banners.
- Validation: responsive screenshots for core routes.

### Task 12.2 WCAG 2.2 AA pass

- Frontend/admin: keyboard flow, focus rings, labels, contrast, reduced motion.
- Validation: automated accessibility scan plus manual keyboard test.

### Task 12.3 Localization workflow

- Backend: language content schema and fallback rules.
- Admin: translation management and review state.
- Frontend: all user-visible content uses translation/content APIs.
- Validation: language switch does not expose missing keys in core flows.

## Validation Matrix Per Feature

For every feature before completion:

- Backend: build/typecheck passes.
- Admin: build/typecheck passes and role guards validated.
- Frontend: build/typecheck passes and public route renders.
- API contract: request/response documented.
- Consent: storage/share/AI/analytics checks verified.
- Safety: 000/1800RESPECT and information-only copy verified where applicable.
- Audit: admin and sensitive backend actions logged.
- Responsive UI: desktop and mobile states checked.
- Regression: no hardcoded frontend data where admin should be source of truth.

## Immediate Next Implementation Slice

Start with Phase 0 and Phase 1 because they reduce drift across all later work:

1. Add a backend `platform-settings` module for safety copy, disclaimers, quick-exit copy, consent policy text, and feature flags.
2. Add admin management UI for platform settings with draft/published states.
3. Add frontend settings client and replace hardcoded safety/disclaimer copy with published backend settings plus safe fallbacks.
4. Update API contract docs.
5. Validate builds across backend, admin, and frontend.
