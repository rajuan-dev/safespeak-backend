# SafeSpeak Product Requirements

SafeSpeak is not a crisis service, legal aid, counselling platform, or case manager.f Triage and Intelligence Platform for Racism, Hate, Online Abuse, and Related Harms in Australia. SafeSpeak is a multilingual, traumainformed triage and intelligence tool. It is not a casemanagement system, not a legal service, not a DV or mentalhealth service, and not a crisis response. It guides, explains, triages, and routes reports to the correct authorities, while generating anonymised insights to improve policy and community safety.

It is a triage and intelligence engine that guides, explains, routes, and generates insight.

## All content is information-only.

## No auto-save, no background tracking, no PII retention beyond consent.

### Every interaction begins with:

“If you are in immediate danger, call 000 now.If it’s safe, contact 1800RESPECT (24/7).”

## Feature Set Overview (What we’re building)

## Multilingual endtoend experience and Cultural/Faith Sensitivity Layer.

## Evidence Vault and Incident Builder (localfirst, consentdriven).

AI LegalAware Triage (Australiaspecific; info only).

## Smart Dialler (emergency/nonemergency + interpreter guidance + covert mode).

Report & Route Engine (single story → multiple destinations).

Support Ecosystem (nonlegal, nonclinical): legal aid info, counselling directories, community advocate matching, safety planning, crisis resource directory.

Cybercrime & Scam Protection: paste/forward/email/screenshot analysis, scam score, redflag explanations, recommended actions, ACCC Scamwatch prereporting and ACSC ReportCyber routing.

MicroEducation Cards (multilingual, youthfriendly) for bullying, racial abuse in schools, online harassment, NSW racial hatred offence.

## Anonymised Insights & Heatmaps by LGA with differential privacy.

## Admin Console for taxonomies, destinations, content, languages, analytics.

## HIGHLEVEL PURPOSE & CONSTRAINTS Purpose

Build SafeSpeak: a traumainformed, multilingual triage & intelligence platform for racism, racial hatred (incl. NSW 2025 law awareness), online abuse, scams and related harms.

The platform guides people to options, matches support, routes structured reports to appropriate authorities or services, and produces privacypreserving insights to drive prevention and policy change.

## Hard Constraints / NonNegotiables

SafeSpeak is NOT: a casemanagement system, legal advice service, counselling service, crisis / emergency response provider, or DV shelter.

## Preconsent safety gate and explicit consent required before any data storage or sharing.

Prominent displayed safety prompts: “If you are in immediate danger, call 000 now.” & “If it’s safe, you can contact 1800RESPECT (24/7).”

Quick Exit available on every screen; no autosaving; no background tracking.

Data residency: Australian cloud regions only.

All AI outputs must be prefaced/clarified as “informationonly” (not legal advice).

## NONGOALS (REITERATED)

## No automatic reporting to police or agencies (reports only forwarded with user consent).

## No background device tracking, fingerprinting, or covert location logging.

## The platform will not assume any duty to pursue cases or investigate.

No storage of user data beyond consented minimal fields; users can withdraw and have data deleted per policy.

## CORE PRODUCT OUTCOMES & KPIs Primary Outcomes

## Increased reporting/triage uptake among CALD communities, youth, seniors.

## Faster, less retraumatising capture of incidents (singlestory reuse).

## Increased warm referrals to culturally relevant community support.

## Measurable anonymised insights (LGA heatmaps) that influence policy actions.

## Core KPIs (Phase specific)

Uptake: Monthly active reporters from priority communities (target MVP: +20% yearonyear in target LGA).

Completion rate: % who finish multidestination submission after intake (>60% target).

Timetoroute: median time from submission to forwarded report (goal < 5 minutes for API; < 60 minutes for secure email batch).

Trust & impact metric: % users reporting increased confidence that their report was seen (target pilot: ≥70%).

ScamShield prevented loss metric: % users who took recommended actions and reported prevented loss.

Privacy incident KPI: zero PII breaches; NDB reports = 0.

## FULL FEATURE LIST — DETAILED FUNCTIONAL REQUIREMENTS (This section enumerates every feature to implement, with specifics.)

## 4.0 Foundational features

## Multiplatform (mobile iOS/Android, responsive web).

## Language detection & selection (user chooses on onboarding or persession).

Cultural/Faith sensitivity profile: user selects community/faith (or skip); used to adapt tone, examples, prioritized services.

## Safety gate & consent flow (detailed below).

## Quick Exit / Covert Mode.

## Localfirst evidence vault (encrypt with device keystore). Cloud sync optin.

## No autosave by default.

## 4.1 Safety Gate & Consent (must be implemented first)

### On app open and before any capture, show:

“If you are in immediate danger, call 000 now.”

“If it’s safe, you can contact 1800RESPECT (24/7).”

Clear statement: SafeSpeak is an information & triage tool — not a crisis, legal or counselling service.

### Buttons:

## Emergency Call (000)

## 1800RESPECT call

## Continue (enters app)

### Consent toggles:

## Store data locally (required to save draft)

## Sync to cloud (optional)

## Share with agencies (per destination, per submit)

## Use anonymised data for analytics

### Quick Exit:

Visible persistent button; when tapped: immediate UI swap to neutral app (e.g., calculator), clear current unsaved inputs from memory, optional hard clear of session.

Covert Mode: masked icon/name, PIN to open. Option available at onboarding with clear instructions and security risks.

## 4.2 Capture / Evidence Vault

### Inputs supported:

## Free text (native language)

Voice notes (ASR to text; audio optionally saved but only with consent)

## Photo / video capture

## Screenshot upload (from gallery)

## File upload (pdf, doc, images)

Paste/forward (email/SMS content) — for ScamShield

### Device metadata (with consent):

## Timestamp (auto)

## Manual location or coarse GPS (onetime consent)

### Evidence storage:

## Local encrypted (Keystore/Keychain) until user consents cloud sync.

On sync: store in AU region cloud; assets hashed; hash stored in report metadata for chainofcustody.

### Chainofcustody:

For each asset compute file hash (SHA256), timestamp, uploader id (if any), store in immutable audit log (signed).

### Incident Builder:

AI extracts structured fields: who, what, when, where, how, language used, repeated incidents, witnesses, injuries, evidence items.

## Presents an editable structured timeline to user.

### Offline mode:

## Capture offline, queue for secure upload on next connection.

## 4.3 Understand (NonLegal Rights/Info)

### AIdriven explainers by jurisdiction (phase 1: NSW specifics):

NSW racial hatred offence (plain language): elements, thresholds, public act vs private, intent, religious teaching carveout, penalties.

Civil vilification/discrimination: available remedies, agencies.

Workplace/education policy: how to raise internal complaints.

## eSafety reporting process for online abuse.

### “Ask in your words”: conversational Q&A that:

## Classifies the issue.

## Suggests possible lawful pathways and support options.

Always adds: “This is information only, not legal advice.”

Microlessons: 30–60 second scenario cards, in text/audio.

## 4.4 Call (Smart Dialler)

### Locationaware recommended numbers:

000, Police Assistance Line, 1800RESPECT, Lifeline, multicultural helplines, university/school contacts (if context selected).

### Call prep:

20–30s script generated in user language; user can edit or read verbatim.

“Ask for an interpreter in [language]” instruction inserted.

### Silent/Covert assistance:

## Pre-prepared instructions on how to request silent help if a helpline supports it.

App does not make covert background calls; only provides user actions.

## 4.5 Report & Route Engine

Single story capture: user enters narrative once.

AI maps narrative to required fields per destination (police form, antidiscrimination form, eSafety form, university grievance form).

### Destination recommender:

Shows for each recommended agency: reason, expected next steps, anonymity options, minimum required info.

### Language translation:

User writes/speaks in native language; AI translates to English; both original and translation attached.

## Consent per destination before sending.

### Submission methods:

Preferred: API integration (secure POST with mutual TLS or OAuth).

Fallback: secure email with structured PDF/JSON attachment and hashed evidence.

### Submission record:

Status: Draft, Submitted, Received (if destination supports acknowledgement), Closed (Forwarded / Infoonly / Withdrawn).

### Reference IDs:

Provide SafeSpeak reference number; capture any destination response reference if provided.

No further case management in SafeSpeak — after forward, SafeSpeak’s role ends except for limited status pings.

## 4.6 Support Ecosystem (NonLegal & NonClinical)

## Emergency contacts (quick dial).

## Legal Aid NSW locator & booking links (and later API integration).

## Community Legal Centres directory & warmreferrals (consented).

Counselling directory: culturally appropriate options; not an inapp counselling session.

### Community Advocate Matching:

## Vetted advocates (background checks, training).

## Match by language, faith, region, issue type.

Aid via mediated chat or appointment scheduling (no personal numbers shown unless user consents).

Safety planning tools: editable templates (personal safety plans, evidence collection checklists).

Crisis resources: 1800RESPECT, Lifeline, Multicultural helplines (clicktocall only).

Educational resource library: downloadable multilingual materials; audio narrated.

## 4.7 ScamShield — Cybercrime & Scam Protection (Full Spec)

### Inputs:

Paste email/SMS text, forward suspect email (with user permission), upload screenshot (OCR performed).

### Processing:

## OCR & entity extraction (phone numbers, URLs, bank references, transaction IDs).

Link reputation analysis: domain age (WHOIS), TLS cert checks, IP geolocation, known bad domain databases, typosquatting detection, homograph attacks.

Sender analysis: email headers (from forwarded email with permission), SPF/DKIM/DMARC checks.

Content analysis: urgency language, payment asks (gift cards, crypto), phishing templates, invoice anomalies.

### Output:

## Scam Probability Score (Low/Medium/High) plus confidence.

## Red flag indicators (detailed list with explanation).

## Recommended immediate actions (do not click, contact bank, change passwords, etc.).

### Oneclick actions:

## Pre-fill ACCC Scamwatch report draft (downloadable/editable).

## Pre-fill ACSC ReportCyber guidance (links & recommended files).

## Pre-filled bank contact template.

## Option to redact PII automatically before generating reports.

### UI/UX:

Clear, plain language explanation; multilingual.

“If you’re in danger/your accounts are at risk, call [bank fraud line]” as appropriate.

### Logging & privacy:

User must explicitly consent to share for ACCC/ACSC reporting; otherwise storing only local analysis.

## 4.8 MicroEducation Cards

Category: school bullying, racial abuse at school, online harassment, platform reporting, workplace misconduct, NSW racial hatred offence, how to use interpreters, scams 101.

Formats: text, audio narration, PDF download, share link.

## Accessible, youthfriendly variants.

## 4.9 Insights, Heatmaps & Analytics (Privacy Preserving)

## Aggregated metrics by LGA, timeframe, category.

Thresholding (no cell displayed unless n ≥ threshold, default 5).

## Differential privacy/noise addition for external exports.

Visualisations: heatmap layers, time trends, category breakdown, top languages affected.

## Export via admin console to partners under MOU (aggregated only).

## 4.10 Admin Console

Roles: Super Admin, Content Admin, Integrations Admin, Analytics Viewer.

### Functions:

## Manage taxonomies (incident types, triage labels).

## Manage destinations & templates.

## Manage languages, cultural profiles, microeducation content.

## View anonymised analytics & heatmaps.

## Access logs (PII removed) and audit trail for admin actions.

## No admin access to identifiable raw user data unless explicit user consented sharing.

## 4.11 Moderation & Safety Controls

Autofilter for illicit content (CSAM, threats, instructions for violent acts) — block and escalate per legal obligation.

Defamation risk mitigation: present allegations as reported by user; discourage naming private individuals unnecessarily; provide redaction options.

Hate speech content handling: categorise for intelligence but follow law on storing/retaining potentially unlawful content — consult legal.

## FULL USER JOURNEYS (detailed step sequences)

## 5.1 New user (Onboarding)

Open app/web → Safety gate displayed (000 / 1800RESPECT) → language & cultural/faith selection → brief orientation on what SafeSpeak does/doesn’t do → explain Quick Exit & Covert Mode → consent toggles (optin analytics, local/cloud storage).

## 5.2 Capture & Triage flow (single story)

User chooses “Capture Incident” → choose input type (text/voice/photo/upload) → evidence added → AI offers edited structured summary & timeline → system asks clarifying questions if needed → user reviews & edits structured fields → AI triage classification displayed (criminal/civil/online/workplace/DV indicator) with plain language explanation (info only) → destination recommender with reasons, anonymity options, and consent toggles → user selects destination(s), previews each submission → user consents & submits → system records submission, returns SafeSpeak reference ID.

## 5.3 ScamShield flow

User selects “ScamCheck” → paste/forward/upload → OCR & analysis → score & red flags show → recommended actions and prefilled ACCC/ACSC draft available → user chooses to send report (explicit consent) or save locally.

## 5.4 Support navigator

User selects “Get Support” → selects category (legal, counselling, community advocate) → personalized list filtered by language/cultural profile & location → choose warm referral (optional) → minimal summary prepared and sent to selected org with user consent or a booking scheduled.

## 5.5 Withdraw / Close / Infoonly

User can mark a report as Informationonly (never forwarded) — contributes only to aggregated analytics (with anonymisation).

User can withdraw a report previously saved (if not forwarded): deletes local & cloud copies per retention policy.

## Once forwarded to correct authority, SafeSpeak marks report closed.

## DATA MODEL & STORAGE, RETENTION, DELETION (concrete) Key Entities (schema summary)

Report { id, created_at, language, lga, context, structured_fields, evidence_refs[], consent_flags, status }

EvidenceAsset { id, type, storage_pointer, sha256_hash, uploaded_at, metadata }

Submission { id, report_id, destination_id, submission_time, channel, status, external_ref }

UserSession (ephemeral): local only until consent

AnalyticsAggregate { lga, date_bucket, category, count, dp_noise_params }

## Storage & Retention

Drafts: default local (auto purged after 30 days if not explicitly saved or forwarded). Configurable per policy.

Forwarded reports: minimal raw copy retained for 90 days to facilitate deletion/subpoena handling then archived for agreed partner periods per MoU. PII retention minimized.

Informationonly reports: retain raw data no longer than 90 days, then aggregate and delete raw source unless user consents otherwise.

Evidence assets: hashed and stored; deletion request removes asset and updates report metadata. If already forwarded to authority, deletion request marked and actioned in SafeSpeak but note that external parties may retain copies (disclose in policy).

User data deletion: onetap “Delete my data” triggers deletion pipeline: remove local caches, delete cloud copies, remove backups (per RPO). Legal exceptions if subpoena/obligation.

## Data Access

Strict RBAC; logs of all access; no direct access for admin staff to raw PII without explicit consent.

Subpoena response policy: legal team to manage; minimisation principle applied.

## AI/ML DESIGN, TRAINING, GUARDRAILS, EVALUATION Models & Capabilities

Multilingual NLU: intent extraction, entity extraction (who/what/where/when), classification (type of harm), severity estimation, DFV indicators.

Translation: productiongrade, communitylanguage tuned models.

ASR/TTS: for supported languages (ondevice where possible).

Scam detection model: trained on phishing emails, scam corpora, synthetic data, and community samples.

Risk Detection: flags for imminent danger/selfharm (only to surface safety messages — no automatic reporting).

## Training Data & Sources

Public legislation text & official agency guidance (NSW Police, AntiDiscrimination NSW, eSafety).

## Public agency forms & Q/A.

## Deidentified scenario datasets (synthetic and curated).

Scam corpora: public datasets (PhishTank, OpenPhish), private partnerships for domain reputation.

## Community validation datasets (with community partners & legal review).

## Guardrails & Safety

All model outputs append the “informationonly” disclaimer.

PROMPT/OUTPUT filtration to avoid legal advice phrasing, prescriptive actions (e.g., “you should sue”), or clinical advice.

## Bias & fairness audits prior to launch and periodically.

## Redteam testing for jailbreaks prompting legal/clinical/crisis guidance.

Humanintheloop review mechanism for edge cases flagged by model (e.g., possible criminal content requiring policy).

## Evaluation Metrics

NLU extraction F1 target: ≥ 0.80 on curated indomain test set.

Triage accuracy (mapping to correct destination): ≥ 0.80 on validation set.

Scam classifier ROC/AUC target: ≥ 0.92 on balanced test set, with priority on low false negatives.

Translation quality: human evaluation in top languages (≥ 90% acceptability in community validation).

## Privacy Considerations

## Ondevice inference where feasible for ASR/TTS and preconsent parsing.

Cloud inference only after consent; all logs anonymised or minimal.

## SECURITY, PRIVACY, COMPLIANCE & LEGAL SAFEGUARDS Security standards & requirements

## OWASP ASVS level 2+.

Mobile hardening: MASVS controls, secure storage, jailbreak/root detection (no blocking but alert / user message).

TLS 1.3, AES256 at rest; KMS for key management with rotation.

## Pen testing prelaunch & quarterly for first year.

## Secrets management via Vault or cloud KMS.

## Privacy & legal

Compliance with Australian Privacy Principles (APPs); Notifiable Data Breaches scheme.

Data residency: AU regions only.

## WCAG 2.2 AA accessibility.

## Clear Terms & Privacy Policy (legal review).

Defamation mitigation: treat user content as allegations; encourage redaction; legal templates for admin.

Youth safety compliance: childsafe measures and guidance for parental consent when required.

No background tracking or device fingerprinting; telemetry only with optin.

## Legal Safeguards & Disclaimers (must be visible)

“SafeSpeak is an information and triage tool. It is not legal advice, counselling, medical, or crisis service. If you are in immediate danger, call 000. For DV support, contact 1800RESPECT.”

## Explicit consent confirmations before forwarding.

## Mandatory legal review of phrasing for all AI outputs and templates.

## INTEGRATIONS & PARTNER CONTRACTS Priority Phase 1 (MVP, NSW focus)

AntiDiscrimination NSW — form/API/email integration.

NSW Police / Police Assistance Line — permitted integration channels (confirm with Police IT).

eSafety Commissioner — complaint prepopulation.

## Legal Aid NSW locator / booking (link / API).

## Community Legal Centres (warm referral via secure email/APIs).

1800RESPECT, Lifeline — clicktocall.

ACCC Scamwatch & ACSC ReportCyber — prefilled report drafts & guidance links.

TIS National — interpreter guidance integration (static content link), not direct interpreter calls.

## Integration modes & security

Preferred: REST API with mutual TLS and OAuth2.0.

Fallback: secure PGP signed emails with JSON/PDF attachment.

Monitoring: delivery receipts and acknowledgements where supported.

## Contracts & MOUs

All integrations requiring partner data exchange must have MoU addressing: data fields shared, retention, response expectations, privacy, data breach protocols, discovery/subpoena handling.

## ADMIN, OPS & OBSERVABILITY Admin Console

Manage: taxonomies, language packs, destinations, content, cultural profiles.

Configure: integration endpoints, API keys, templates.

RBAC: enforce via SSO (OIDC), audit logging.

## No raw PII access without logged, reasoned consent.

## Observability & SLAs

Monitoring: Prometheus/Grafana for infra metrics, Sentry for errors (PII scrubbed).

Uptime target: 99.9% for core services.

Latency targets: UI <2s; translation/ASR <10s typical.

Incident response: oncall rotation, runbooks.

## Backup & DR

Daily backups encrypted inregion; restore test quarterly.

RTO ≤ 4 hours; RPO ≤ 1 hour for core services.

## UX, ACCESSIBILITY, CONTENT & LOCALIZATION UX Principles

Traumainformed: minimize repetitive narrative entry; provide gentle prompts; avoid blame language.

Cultural sensitivity: content adapts to faith/community profile.

Youth & low literacy: simple language, icons, audio narration.

## Quick Exit & covert mode manifest on clear paths.

## Localization

Phase 1: top 8 languages for NSW (e.g., Arabic, Mandarin, Cantonese, Vietnamese, Punjabi, Hindi, Nepali, Greek) — to be validated with partners.

Content translation: human validation for legal/microeducation content.

TTS/ASR: for core languages; ondevice where possible.

## Content & Copy

## Copy deck for safety prompts, disclaimers, microcards, call scripts, email templates.

## All content legalreviewed and community validated.

## HEATMAPS, ANALYTICS & REPORTING (privacy preserving)

Heatmap aggregation: aggregated by LGA and category; thresholds (n ≥ 5).

Differential privacy: add calibrated noise for external exports.

Time series: weekly, monthly views.

Access: Admin console & partner dashboards (MoU).

Data exports: aggregated CSV/JSON with dp parameters documented.

## SCAMSHIELD (DETAILED) Inputs & ingestion

Email forwarding instructions: forensic copy option (user permission).

## Screenshot upload UI with OCR.

## SMS paste field.

## Processing & detection

### Use layered detection:

## Content model (text)

## URL analysis (WHOIS, TLS, IP)

## Domain reputation (PhishTank, OpenPhish, private feeds)

## Sender header checks (if available)

## Heuristics for social engineering patterns

### Scoring:

Score bands: Low (0–39), Medium (40–69), High (70–100)

Confidence % and explanation.

## Actions & outputs

Red flag list and “why this matters”.

## Safe next steps and templates for contacting banks, telcos.

## Prefilled ACCC Scamwatch & ACSC ReportCyber drafts.

## Optional warm referral to community financial counselling (with consent).

## Privacy & legal

## Explicit consent required for forwarding any content to authorities.

Offer automated redaction: remove IDs, numbers, addresses before sharing.

## SUPPORT ECOSYSTEM & ADVOCATE NETWORK Support catalog

Legal Aid NSW, Community Legal Centres (with booking links), culturallyappropriate counselling directories, multicultural organisations, faith community services, youth services.

## Advocate Matching

Advocate profiles (language, region, training credentials), vetting process, optin for advocates.

Interaction modes: mediated contact (advocate contact request), inapp secure chat (no phones), scheduled callbacks.

Data minimisation: only share minimal summary with advocate upon consent.

## Warm referrals & scheduling

User chooses to send minimal summary to org; scheduling link or callback request forwarded securely.

## Logs of referrals stored (consent flags) for analytics of warmreferral uptake.

## Partner onboarding

Training materials & MoUs for advocates and partner orgs (data handling, expectations, response times).

EPICS, USER STORIES & TEST CASES (sample) Epic: Intake & Safety

Story: As a user, I want to see emergency contacts before I type so I can act if in danger.

Test: Safety gate appears; 000 and 1800RESPECT buttons function.

Epic: Single Story → Multi Destination

Story: As a user, I want my incident captured once and reused across forms.

Test: Input narrative → autogenerated structured fields → previews for each destination → forwarded with consent.

Epic: ScamShield

Story: As a user, I want to paste a suspicious SMS and get a clear risk rating and next steps.

Test: Upload sample phishing SMS screenshot → OCR extracts text → model rates High → UI shows red flags and prefilled ACCC draft.

Epic: Heatmaps

Story: As a policymaker, I want aggregated counts by LGA with thresholding.

Test: Add 6 sample reports to LGA → heatmap cell shows; with 4 reports heatmap cell is suppressed.

## TECH STACK, INFRA, CI/CD & DEPLOYMENT Recommended stack

Mobile: Flutter (single codebase), native modules for secure storage.

Web: React + Next.js.

Backend: Node.js (TypeScript) or Python (FastAPI) for APIs.

DB: PostgreSQL (primary), Redis (queue & cache).

Object storage: S3 compatible (AU region).

ML infra: managed inference in AU region; GPU nodes for model finetuning.

KMS: cloud KMS or HashiCorp Vault; HSM for signing where needed.

IaC: Terraform.

CI/CD: GitHub Actions or GitLab CI; automated test suites & SAST/DAST.

Observability: Prometheus + Grafana, ELK or managed logs, Sentry for client errors.

## DevOps & DR

Dev / Staging / Prod separate; strict IAM and key separation.

## Blue/Green or canary deploys for production.

Daily backups; quarterly restore drill.

## QA, COMMUNITY VALIDATION & ROLLOUT Testing types

## Unit, integration, e2e tests

## Multilingual regression tests

## Accessibility audits (WCAG 2.2 AA)

## Pen tests & redteam

## AI model bias & safety tests

## Usability testing with community cohorts (migrants, youth, seniors, advocacy orgs)

## Pilot rollout

Select 2–3 partner organisations (universities, migrant orgs, community legal centre) for closed pilot.

## Community codesign sessions for content refinements.

Pilot duration: 8–12 weeks with iterative sprints.

## National rollout

Phased by state; integrate with state agencies during prelaunch partner engagements.

## LEGAL CHECKLIST, DISCLAIMERS & RISK TABLE Legal tasks (prelaunch & continuous)

## Draft/approve Terms of Service & Privacy Policy.

## Legal signoff on all AI speech templates & disclaimers.

## Defamation risk review for reporting templates.

## Child safety compliance & policy.

## MoUs with partner agencies (data sharing, response SLAs).

## Subpoena & law enforcement request policy & process.

Insurance coverage: cyber liability & professional indemnity.

## Mustdisplay disclaimers

## Safety gate text (000 & 1800RESPECT).

“Information only” disclaimer on all AI outputs.

## Consent confirmations for any forwarding.

## Risk table (examples)

Risk: Users expect case resolution → Mitigation: Clear UX & repeated disclaimers; Trust Engine shows aggregated impact (not promises).

Risk: Legal exposure via defamation → Mitigation: Redaction, present as allegations, legal review of templates.

Risk: Data breach → Mitigation: Strong encryption, pen tests, limited retention.

Risk: AI provides advice that looks like legal counsel → Mitigation: Hard prompt guardrails, human review, legal approved outputs.

## FINAL ACCEPTANCE CRITERIA (SUMMARY)

## Safety gate & Quick Exit functional and tested across platforms.

## No data stored preconsent.

Single story intake reused for multidestination submission and successfully forwarded to at least 3 destination types (AntiDiscrimination, eSafety, Legal Aid/CLC) via API or secure email with correct template.

## ScamShield produces accurate score & actionable output for sample datasets.

## Multilingual flows validated in top languages (human review).

## Heatmaps show aggregated data only above threshold & with dp noise.

## Legal signoff on terms, disclaimers, and AI phrasing.

## Pen test passed (no critical CVEs).

## Community pilot results show target acceptance and trust metrics.

SafeSpeak: 20 User Stories

Real scenarios from Australian communities experiencing racism, hate speech, and related harms

## Verbal Racism & Hate Speech

Story 1: Public Transport Racial Abuse

"As a university student wearing a hijab, someone on the train yelled 'Go back to your own country, terrorist!' in front of other passengers. I want to report this but don't know if it's a police matter or what my options are."

### SafeSpeak Journey:

## User selects language (Arabic/English)

AI explains: NSW racial hatred offence (public act, intent to incite hatred), civil vilification options

Routes to: NSW Police, Anti-Discrimination NSW, university support services

Provides: TIS interpreter guidance, cultural support directory

Story 2: Workplace Racial Slurs

"My supervisor at the construction site keeps calling me 'curry boy' and making jokes about my accent in team meetings. When I complained, HR said 'it's just Aussie banter.' I'm on a work visa and scared to push back."

### SafeSpeak Journey:

Captures: specific words used, witnesses present, HR response

AI explains: workplace discrimination vs criminal hate speech, visa safety facts

Routes to: Fair Work Ombudsman, Anti-Discrimination NSW, Community Legal Centre

Provides: safety planning for visa holders, employment law basics

Story 3: School Yard Racial Taunts

"Kids at my daughter's school keep saying 'ching chong' and pulling their eyes back when they see her. The teacher said 'kids will be kids' but it's happening every day."

### SafeSpeak Journey:

## Parent/guardian pathway with simplified language

AI explains: school anti-bullying policies, Department of Education pathways

Routes to: school principal, Department of Education complaints, cultural liaison

Provides: how to document incidents, parent advocacy resources

## Online Harassment & Digital Abuse

Story 4: Social Media Hate Campaign

"Someone created a fake profile using my photo and posted it in local Facebook groups saying I'm a 'welfare terrorist.' Now I'm getting death threats in my DMs."

### SafeSpeak Journey:

## Screenshots captured with metadata

AI explains: online safety laws, platform reporting, possible criminal threats

Routes to: eSafety Commissioner, NSW Police (threats), platform reporting shortcuts

Provides: account security checklist, digital evidence preservation tips

Story 5: Dating App Racial Fetishization

"Men on dating apps keep messaging me things like 'I've never been with an Asian girl' and asking if I'm 'tight like all Asian women.' It makes me feel disgusted and unsafe."

### SafeSpeak Journey:

## Content categorized as sexual harassment with racial elements

AI explains: platform terms of service violations, possible sexual harassment

Routes to: platform reporting, eSafety (image-based abuse if applicable)

Provides: digital safety for women, culturally appropriate counselling

Story 6: Gaming Platform Abuse

"Every time I speak in voice chat while gaming, players start making 'terrorist' jokes and telling me to 'blow something up.' I just want to play games without this harassment."

### SafeSpeak Journey:

## Voice/text evidence capture

AI explains: platform community guidelines, pattern of targeted harassment

Routes to: gaming platform reporting, eSafety (if persistent), mental health support

Provides: online gaming safety tips, community support groups

## Workplace Discrimination

Story 7: Promotion Denial with Racial Comments

"My manager told me 'customers prefer dealing with locals' when explaining why I didn't get promoted, even though I've been here 3 years and have the best sales numbers."

### SafeSpeak Journey:

Documents: performance metrics, exact quotes, promotion criteria

## AI explains: workplace discrimination law, evidence requirements

Routes to: Fair Work Ombudsman, Anti-Discrimination NSW, union (if applicable)

Provides: workplace rights for migrants, Legal Aid NSW locator

Story 8: Religious Accommodation Denial

"HR said I can't take time for Friday prayers because 'this isn't a Muslim country' and I need to 'integrate better' if I want to succeed here."

### SafeSpeak Journey:

## Religious discrimination pathway highlighted

AI explains: religious accommodation rights, unlawful discrimination

Routes to: Fair Work Ombudsman, Australian Human Rights Commission, Islamic Council

Provides: religious rights factsheet, faith-appropriate legal support

## Educational Settings

Story 9: University Tutorial Racism

"During a class discussion about immigration, another student said 'people like you are taking jobs from real Australians' while looking directly at me. The tutor didn't say anything."

### SafeSpeak Journey:

## University-specific pathway activated

AI explains: university equity policies, academic environment protections

Routes to: university equity office, student union, counselling services

Provides: student rights guide, peer support networks

Story 10: Teacher's Discriminatory Comments

"My child's teacher told the class that 'some cultures don't value education' while discussing homework completion rates. My son was the only non-white child who hadn't submitted homework."

### SafeSpeak Journey:

## Parent advocacy pathway with child protection elements

AI explains: educational discrimination, child's rights at school

Routes to: school principal, Department of Education, multicultural education support

Provides: parent advocacy scripts, cultural liaison services

## Housing & Services

Story 11: Rental Discrimination

"The real estate agent said the landlord 'prefers local tenants' and asked if I 'cook smelly food' when I applied for the apartment. I have perfect references and stable income."

### SafeSpeak Journey:

## Housing discrimination pathway

## AI explains: anti-discrimination in housing, evidence requirements

Routes to: Fair Trading NSW, Anti-Discrimination NSW, Tenants Union

Provides: housing rights for migrants, discrimination complaint templates

Story 12: Healthcare Provider Bias

"The doctor said my pain was probably 'cultural' and I should 'try meditation' instead of prescribing medication. I felt dismissed because of my appearance."

### SafeSpeak Journey:

## Healthcare discrimination flagged

## AI explains: patient rights, cultural competency requirements

Routes to: Medical Board complaints, Anti-Discrimination NSW, health advocacy

Provides: patient advocacy resources, culturally appropriate healthcare directory

## Community & Public Spaces

Story 13: Retail Store Racial Profiling

"Security follows me around every time I shop at this store, but I've watched white customers take things without being watched. Yesterday they asked to check my bag when others weren't checked."

### SafeSpeak Journey:

## Retail discrimination with pattern documentation

AI explains: consumer rights, indirect discrimination

Routes to: Fair Trading NSW, store management, Anti-Discrimination NSW

Provides: consumer rights factsheet, incident documentation tips

Story 14: Neighbor Harassment

"My neighbor keeps telling me to 'speak English in Australia' when I talk to my kids in our language in our own yard. He plays loud music when we have family gatherings."

### SafeSpeak Journey:

## Community dispute with racial elements

AI explains: neighborhood disputes vs racial harassment, noise ordinances

Routes to: local council mediation, NSW Police (if escalating), community justice centre

Provides: neighbor dispute resolution, multicultural community support

## Youth-Specific Scenarios

Story 15: School Lunch Discrimination

"Kids at school say my lunch 'smells disgusting' and hold their noses when I eat. They call it 'gross foreign food' even though it's just rice and curry."

### SafeSpeak Journey:

## Youth-friendly interface with simple language

AI explains: cultural bullying, school anti-discrimination policies

Routes to: school counsellor, principal, Department of Education youth support

Provides: peer support networks, cultural pride resources

Story 16: Sports Team Exclusion

"The coach never picks me for the starting team even though I'm one of the best players. I heard him tell another parent he 'prefers Aussie kids' for leadership positions."

### SafeSpeak Journey:

## Sports discrimination in educational setting

AI explains: equal opportunity in sports, school policy violations

Routes to: school sports coordinator, principal, sporting body complaints

Provides: youth advocacy, sports inclusion resources

## Cybercrime & Scams

Story 17: Romance Scam with Racial Targeting

"Someone on a dating app said they 'love Asian women' and started asking for money for their 'sick mother.' They knew exactly what to say about my culture to gain my trust."

### SafeSpeak Journey:

## ScamShield analyzes conversation patterns

AI explains: romance scam red flags, cultural targeting tactics

Routes to: ACCC Scamwatch, local police (if money lost), financial counselling

Provides: romance scam prevention, culturally appropriate support

Story 18: Fake Immigration Service Scam

"I got an official-looking email saying my visa was being cancelled and I needed to pay $500 immediately to 'fix the problem.' It looked real and I almost paid."

### SafeSpeak Journey:

## ScamShield detects government impersonation

AI explains: official government communication methods, visa scam tactics

Routes to: ACCC Scamwatch, Department of Home Affairs (verify), migration agents board

Provides: visa scam prevention, legitimate immigration help

## Family & Domestic Context

Story 19: DV with Cultural Isolation Threats

"My husband said if I leave him, he'll tell immigration that our marriage was fake and I'll be deported. He controls all our documents and money."

### SafeSpeak Journey:

DV indicators flagged immediately; safety planning prioritized

AI explains: visa rights in DV situations, family violence provisions

Routes to: 1800RESPECT, family violence services, migration law specialist

Provides: safety planning for migrant women, emergency accommodation

Story 20: Elder Financial Abuse with Racial Elements

"Someone called my elderly father pretending to be from Medicare, speaking in broken Mandarin, saying his benefits would be cut unless he paid a 'processing fee.' He almost sent them money."

### SafeSpeak Journey:

## Elder abuse and scam intersection identified

AI explains: government impersonation scams, elder protection services

Routes to: ACCC Scamwatch, elder abuse helpline, NSW Police (if money lost)

Provides: elder protection, family financial security, Mandarin-speaking support

### Key Features Highlighted Across Stories:

### Safety & Privacy:

## Quick Exit button for all vulnerable situations

## No auto-saving of sensitive content

## Covert mode for DV situations

## Clear safety disclaimers before any data entry

### Cultural Sensitivity:

## Faith-appropriate service matching

## Community language support throughout

## Cultural context awareness in AI responses

## Trauma-informed language and approach

### Smart Routing:

Single story → multiple destination forms

## AI triage based on incident type and jurisdiction

## Consent required before forwarding to any authority

## Status tracking where supported by partners

### Support Integration:

## Warm referrals to culturally appropriate services

## Legal Aid NSW and Community Legal Centre connections

## Crisis support integration (1800RESPECT, Lifeline)

## Community advocate matching

### Innovation Elements:

## ScamShield AI for cybercrime prevention

## Trust Engine showing anonymized impact data

## Micro-education cards in community languages

## Evidence vault with chain-of-custody support

Each user story demonstrates how SafeSpeak transforms from a simple reporting tool into a comprehensive support ecosystem that meets people where they are, speaks their language, understands their cultural context, and guides them toward appropriate help while respecting their autonomy and safety.

