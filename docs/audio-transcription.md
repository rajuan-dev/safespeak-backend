# Voice Input, Transcription, and Spoken AI Response

## Purpose

SafeSpeak backend supports voice-to-text for uploaded audio/video evidence, direct voice-note transcription during report intake, and temporary text-to-speech for the public AI conversation flow.

The public assistant continuous voice path is:

1. User clicks Start/Tap to start recording in the existing SafeSpeak assistant/report page.
2. Frontend sends the audio to `POST /api/v1/ai/transcribe-audio`.
3. The transcript is shown as the normal user chat message and sent through the existing conversation/session API.
4. The visible assistant response text is sent to `POST /api/v1/ai/synthesize-speech`.
5. Frontend creates a temporary browser blob URL and plays the assistant response aloud.
6. If voice mode is still active, the frontend starts the next listening turn automatically.
7. Clicking Stop Recording ends the voice session, stops the microphone loop, and stops playback/restart timers.

Typed chat keeps using the same conversation/session flow and does not require voice playback.

## Consent

Transcription is allowed only when at least one of these flags is true:

- `process_with_ai`
- `transcribe_audio`

Assistant spoken response / TTS requires:

- `process_with_ai`

Evidence upload/storage still follows existing evidence consent (`cloud_sync`) rules.

## Endpoints

- `POST /api/v1/ai/transcribe-audio`
- `POST /api/v1/ai/synthesize-speech`
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
    "model": "gpt-4o-mini-transcribe",
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

`POST /api/v1/ai/synthesize-speech` (JSON):

```json
{
  "text": "Visible assistant response only.",
  "language": "en",
  "voice": "alloy"
}
```

Success:

```json
{
  "success": true,
  "message": "Speech synthesized successfully",
  "data": {
    "audioBase64": "...",
    "mimeType": "audio/mpeg",
    "model": "gpt-4o-mini-tts",
    "voice": "alloy",
    "temporary": true
  },
  "meta": {
    "informationOnly": true
  }
}
```

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
- `OPENAI_TRANSCRIPTION_MODEL` (default `gpt-4o-mini-transcribe`)
- `OPENAI_TTS_MODEL` (default `gpt-4o-mini-tts`)
- `OPENAI_TTS_VOICE` (default `alloy`)
- `ASR_MAX_FILE_SIZE_BYTES` (default `26214400`)

## Privacy and security

- No transcription without consent.
- No TTS generation without AI processing consent.
- Raw audio buffers are not logged.
- Full transcripts are not logged.
- Transcription metadata is audit logged.
- TTS audit metadata stores model, voice, text hash, character count, and temporary-audio flag only.
- TTS reads only the visible assistant response, not hidden prompts, system messages, safety metadata, citations, triage metadata, or internal IDs.
- TTS audio is returned as temporary response data; it is not persisted by the backend.
- Evidence transcription reads decrypted file content from evidence vault runtime path only.

## Evidence and report integration

- Evidence transcription can be persisted under `evidence.transcription`.
- If `reportId` is provided, a transcription reference is appended to report `structuredFields.evidenceItems`.
- `useAsNarrative=true` writes transcript into `report.originalNarrative` only when report consent snapshot allows narrative storage (`cloud_sync`).

## Voice-first UAT requirements

- Microphone permission works on supported Chrome, Edge, and Safari versions.
- Recording, stop-recording, and no-speech/noisy-audio fallback states work.
- Transcript enters the real AI conversation/session flow as a normal user message.
- Assistant response appears in the normal chat UI.
- Assistant response is spoken back after voice-originated turns and listening restarts automatically while voice mode is active.
- User can stop and replay spoken response.
- Stop Recording ends the continuous voice session.
- Browser autoplay block shows a tap-to-play fallback.
- Missing consent triggers the existing consent gate and typing remains available.
- Unsupported browser or missing microphone shows a calm fallback.
- Typed chat still works without voice playback side effects.
