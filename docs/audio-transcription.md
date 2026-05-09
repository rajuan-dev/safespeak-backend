# Audio Transcription

## Purpose
SafeSpeak backend supports voice-to-text for uploaded audio/video evidence and direct voice-note transcription during report intake.

## Consent
Transcription is allowed only when at least one of these flags is true:
- `process_with_ai`
- `transcribe_audio`

Evidence upload/storage still follows existing evidence consent (`cloud_sync`) rules.

## Endpoints
- `POST /api/v1/ai/transcribe-audio`
- `POST /api/v1/evidence/:id/transcribe`
- `GET /api/v1/evidence/:id/transcription`

## Request/response examples
`POST /api/v1/ai/transcribe-audio` (multipart/form-data):
- `audio` (file, required)
- `reportId` (optional)
- `evidenceId` (optional)
- `language` (optional)
- `saveTranscript` (optional, default true)
- `useAsNarrative` (optional, default false)

Success:
```json
{
  "success": true,
  "message": "Audio transcribed successfully",
  "data": {
    "transcript": "...",
    "language": "en",
    "model": "whisper-1",
    "reportId": "...",
    "evidenceId": "...",
    "saved": true
  },
  "meta": {}
}
```

`POST /api/v1/evidence/:id/transcribe` (JSON):
```json
{
  "language": "en",
  "saveTranscript": true,
  "reportId": "optional-report-id",
  "useAsNarrative": false
}
```

`GET /api/v1/evidence/:id/transcription` returns saved transcription metadata and text.

## Supported MIME types
- `audio/mpeg`
- `audio/mp3`
- `audio/wav`
- `audio/webm`
- `audio/mp4`
- `audio/m4a`
- `video/mp4`
- `video/webm`

## Environment
- `OPENAI_API_KEY`
- `OPENAI_TRANSCRIPTION_MODEL` (default `whisper-1`)
- `ASR_MAX_FILE_SIZE_BYTES` (default `26214400`)

## Privacy and security
- No transcription without consent.
- Raw audio buffers are not logged.
- Full transcripts are not logged.
- Transcription metadata is audit logged.
- Evidence transcription reads decrypted file content from evidence vault runtime path only.

## Evidence and report integration
- Evidence transcription can be persisted under `evidence.transcription`.
- If `reportId` is provided, a transcription reference is appended to report `structuredFields.evidenceItems`.
- `useAsNarrative=true` writes transcript into `report.originalNarrative` only when report consent snapshot allows narrative storage (`cloud_sync`).
