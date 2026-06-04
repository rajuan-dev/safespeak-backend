# ScamShield Manual Test Plan

## Before you start

1. Start the backend:

```powershell
cd d:\RAJUAN-PERSONAL\VSCODE\safespeak\safespeak-backend
npm run dev
```

2. Start the frontend:

```powershell
cd d:\RAJUAN-PERSONAL\VSCODE\safespeak\safespeak-frontend
npm run dev
```

3. Make sure you have either:
   - a logged-in user session, or
   - an anonymous session token from the frontend flow

4. For best coverage, check these optional env vars:
   - `OPENAI_API_KEY`
   - `SCAMSHIELD_URLHAUS_AUTH_KEY`
   - `SCAMSHIELD_SAFE_BROWSING_API_KEY`

## Fast UI test flow

Open:

```text
http://localhost:3000/dashboard?view=scamshieldintake
```

Run these cases.

### Case 1: High-risk phishing text

Input mode: `Paste text`

Use:

```text
Urgent: Your PayPal account is suspended. Verify now at https://paypal-security-login.example/verify and enter your password and one-time code immediately.
```

Expected:
- Risk is `high` or `critical`
- Red flags mention urgency, credential request, link, impersonation
- URL/domain details appear
- Recommended actions say not to click, not to share codes, verify through official channels

### Case 2: Scam URL check

Input mode: `Check URL`

Use:

```text
paypal-security-login.example
```

Expected:
- URL is normalized to `https://...`
- Link reputation section appears
- If threat-intel keys are configured, extra reputation signals may appear

### Case 3: Email with headers

Input mode: `Analyze email`

Sender:

```text
alerts@paypal.example
```

Subject:

```text
Immediate account verification required
```

Headers:

```text
Authentication-Results: mx.example; spf=fail smtp.mailfrom=spoof.example; dkim=fail header.d=spoof.example; dmarc=fail
Reply-To: help@different.example
Return-Path: <mailer@different.example>
```

Body:

```text
Your account will be closed today unless you verify it now. Use the secure portal below and enter your password and OTP.
```

Expected:
- Sender checks section appears
- SPF/DKIM/DMARC results appear
- Reply-To mismatch is detected
- Risk is high

### Case 4: Bank-transfer scam text

Input mode: `Paste text`

Use:

```text
Please update supplier payment details. New bank details: BSB 062-000, account number 12345678. Payment reference INV-884421. Transaction ID TXN-778899.
```

Expected:
- Bank references extracted
- Transaction ID extracted
- Payment redirection or invoice scam indicators appear

### Case 5: Local-only privacy behavior

Before running analysis:
- Keep `process_with_ai=true`
- Keep `cloud_sync=false`
- Keep `share_with_agencies=false`

Run any analysis.

Expected:
- Analysis still works
- Risk page mentions it is saved locally in this browser session
- Draft generation still works
- No server-only requirement blocks basic analysis

### Case 6: Draft redaction

From the agency page:
- Turn on `Auto-redact personal details`
- Try both `Use labels` and `Mask values`

Expected:
- Emails, phones, URLs, amounts, and transaction IDs are redacted in the generated draft

### Case 7: Scamwatch handoff

From the risk page:
- Go to report flow
- Open Scamwatch section

Expected:
- Download button works
- Official guidance link opens
- If admin destination config exists, destination contact data may appear

### Case 8: ReportCyber handoff

From the risk page:
- Go to report flow
- Open ReportCyber section

Expected:
- Download button works
- ACSC/ReportCyber guidance link opens
- If delivery is configured, backend can record/send through delivery flow

### Case 9: Bank fraud handoff

Use text mentioning one of these banks:
- ANZ
- Commonwealth Bank
- NAB
- Westpac

Example:

```text
Caller claimed to be from Commonwealth Bank and asked for my OTP to stop a suspicious transaction.
```

Expected:
- Bank section shows bank-specific call action when detected
- Bank template download works

## API tests

Replace:
- `TOKEN` with your bearer token
- or use the session header approach your frontend uses

### 1. Analyze text

```powershell
curl -X POST http://localhost:5000/api/v1/scamshield/analyze-text `
  -H "Authorization: Bearer TOKEN" `
  -H "Content-Type: application/json" `
  -d "{\"text\":\"Urgent: verify your bank account now at https://bank-login-check.example and enter your OTP.\",\"language\":\"en\"}"
```

Expected:
- `riskScore`
- `riskLevel`
- `redFlags`
- `recommendations`

### 2. Analyze email

```powershell
curl -X POST http://localhost:5000/api/v1/scamshield/analyze-email `
  -H "Authorization: Bearer TOKEN" `
  -H "Content-Type: application/json" `
  -d "{\"from\":\"alerts@paypal.example\",\"subject\":\"Verify now\",\"body\":\"Your account will be closed today. Log in now and enter your OTP.\",\"forwardedWithPermission\":true,\"headers\":{\"Authentication-Results\":\"mx.example; spf=fail smtp.mailfrom=spoof.example; dkim=fail header.d=spoof.example; dmarc=fail\",\"Reply-To\":\"help@different.example\",\"Return-Path\":\"mailer@different.example\"}}"
```

Expected:
- `metadata.senderAnalysis`
- sender mismatch signals
- high-risk result

### 3. Analyze URL

```powershell
curl -X POST http://localhost:5000/api/v1/scamshield/check-url `
  -H "Authorization: Bearer TOKEN" `
  -H "Content-Type: application/json" `
  -d "{\"url\":\"https://paypal-security-login.example/verify\"}"
```

Expected:
- `metadata.urlReputation`
- domain/TLS/signal info

### 4. Redact content

```powershell
curl -X POST http://localhost:5000/api/v1/scamshield/redact `
  -H "Authorization: Bearer TOKEN" `
  -H "Content-Type: application/json" `
  -d "{\"text\":\"Contact me at user@example.com or +61 400 000 000. Pay AUD 250 at https://evil.example. Transaction ID TXN-778899.\",\"replacement\":\"labels\"}"
```

Expected:
- `redactedText` contains `[EMAIL]`, `[PHONE]`, `[AMOUNT]`, `[URL]`, `[TRANSACTION_ID]`

### 5. Generate draft from local snapshot

Use the JSON returned from analysis as `analysisSnapshot`.

```powershell
curl -X POST http://localhost:5000/api/v1/scamshield/generate-report-draft `
  -H "Authorization: Bearer TOKEN" `
  -H "Content-Type: application/json" `
  -d "{\"analysisSnapshot\":{\"type\":\"text\",\"riskLevel\":\"high\",\"riskScore\":82,\"summary\":\"High scam risk detected.\",\"indicators\":[\"credential request\",\"link in message\"],\"redFlags\":[\"The message asks for account access details.\"],\"recommendations\":[\"Do not click the link.\"],\"extractedEntities\":{\"urls\":[\"https://evil.example/login\"],\"emailAddresses\":[\"spoof@evil.example\"],\"phoneNumbers\":[\"+61 400 000 000\"],\"amounts\":[\"AUD 250\"],\"paymentMethods\":[\"bank transfer\"],\"organizations\":[\"paypal\"],\"accountTerms\":[\"login\"],\"cryptoReferences\":[],\"bankReferences\":[\"account number\"],\"transactionIds\":[\"TXN-778899\"],\"urlSignals\":[\"sensitive action in link\"],\"primaryUrlDomain\":\"evil.example\",\"possibleSender\":\"spoof@evil.example\"},\"metadata\":{\"language\":\"en\"}},\"autoRedactPII\":true,\"redactionMode\":\"labels\"}"
```

Expected:
- `draftReport`
- redacted draft text
- destination helper data

### 6. Submit/share

Only do this after `share_with_agencies=true`.

```powershell
curl -X POST http://localhost:5000/api/v1/scamshield/submit `
  -H "Authorization: Bearer TOKEN" `
  -H "Content-Type: application/json" `
  -d "{\"analysisSnapshot\":{\"type\":\"text\",\"riskLevel\":\"high\",\"riskScore\":82,\"summary\":\"High scam risk detected.\",\"indicators\":[\"credential request\"],\"redFlags\":[\"The message asks for account access details.\"],\"recommendations\":[\"Do not click the link.\"],\"metadata\":{\"language\":\"en\"}},\"destination\":\"reportCyber\",\"consentToShare\":true}"
```

Expected:
- status becomes `submitted`
- if destination delivery is configured, metadata includes delivery outcome
- if not configured, metadata should still explain the fallback/manual outcome

## What to verify in the response

For each response, check:
- `riskScore`
- `riskLevel`
- `confidence`
- `summary`
- `redFlags`
- `recommendations`
- `extractedEntities`
- `metadata.urlReputation`
- `metadata.senderAnalysis`
- `metadata.storageMode`
- `draftReport`

## Good signs that full flow is working

- Analysis works with `cloud_sync=false`
- Sharing is blocked until `share_with_agencies=true`
- Drafts can be generated from local snapshots
- Scamwatch/ReportCyber/bank actions are visible
- Delivery metadata appears after submit when configured
- Non-English runs return localized output when AI translation is available

## End-of-spec validation tests

Use these four extra tests at the end to validate the core ScamShield specification areas directly.

### 10. OCR and entity extraction

Goal:
- Verify OCR and extraction of phone numbers, URLs, bank references, and transaction IDs

Upload:
- a screenshot, scanned PDF, or Word file containing text like:

```text
Urgent bank notice. Call +61 400 000 000.
Visit https://secure-check.example/login
New bank details: BSB 062-000, account number 12345678
Payment reference INV-884421
Transaction ID TXN-778899
```

Expected:
- OCR runs for image/PDF inputs where applicable
- `extractedEntities.phoneNumbers` includes the phone number
- `extractedEntities.urls` includes the URL
- `extractedEntities.bankReferences` includes BSB/account or payment reference markers
- `extractedEntities.transactionIds` includes `TXN-778899`
- `metadata.uploadedFiles` and `metadata.extractedTextLength` are populated for file uploads

### 11. Link reputation analysis

Goal:
- Verify domain age, TLS, IP geolocation, known-bad-domain checks, typosquatting detection, and homograph handling

Test URLs:

```text
paypal-security-login.example
xn--pple-43d.example
http://192.168.1.10/login
www.legislation.gov.au
```

Expected:
- `metadata.urlReputation` is present
- `checksRun` includes DNS/TLS/RDAP and may include `ip_geolocation`, `urlhaus`, or `google_safe_browsing` when configured
- suspicious domains may show signals like:
  - `recent domain registration`
  - `possible typosquatting`
  - `possible homograph attack`
  - `known malicious host listing`
  - `known harmful url database match`
- `http://192.168.1.10/login` should show technical URL risk like IP-based or unencrypted link behavior
- `www.legislation.gov.au` should not be treated as a scam just for being a government legislation domain

### 12. Sender analysis with headers

Goal:
- Verify forwarded-email header analysis and SPF/DKIM/DMARC checks

Use:

```text
From: alerts@paypal.example
Subject: Immediate account verification required
```

Headers:

```text
Authentication-Results: mx.example; spf=fail smtp.mailfrom=spoof.example; dkim=fail header.d=spoof.example; dmarc=fail
Reply-To: help@different.example
Return-Path: <mailer@different.example>
Received-SPF: fail
```

Body:

```text
Your account will be closed today unless you verify it now. Use the secure portal below and enter your password and OTP.
```

Expected:
- `metadata.senderAnalysis` is present
- SPF shows `fail` or equivalent failure state
- DKIM shows `fail`
- DMARC shows `fail`
- mismatch indicators such as `reply-to mismatch` or `return-path mismatch` appear
- result is `high` or `critical`

### 13. Content analysis

Goal:
- Verify urgency language, payment asks, gift cards, crypto, phishing-style wording, and invoice anomalies

Test A:

```text
Urgent final notice. Your account will be suspended today unless you verify immediately and enter your password and OTP.
```

Expected:
- urgency and credential-request signals appear

Test B:

```text
Pay the overdue fee today using Apple gift cards or Bitcoin. Send the code after payment.
```

Expected:
- gift-card and crypto/payment scam signals appear

Test C:

```text
Please use our updated bank details for supplier payment. Invoice attached. Remit today to avoid delay.
```

Expected:
- invoice anomaly or payment-redirection indicators appear

Test D:

```text
You have won a refund bonus. Click the secure link now to claim compensation.
```

Expected:
- phishing-template style language, reward/refund lure, and risky link signals appear
