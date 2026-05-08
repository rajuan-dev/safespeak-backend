# SafeSpeak Backend

SafeSpeak Backend is the Node.js, Express, TypeScript, and MongoDB foundation for a trauma-informed, multilingual triage and intelligence platform for racism, hate speech, online abuse, scams, discrimination, and related harms in Australia.

This repository currently contains foundation setup only. It intentionally does not implement auth, reports, evidence, AI/RAG, ScamShield, admin APIs, analytics, or business workflows.

## Tech Stack

- Node.js 20+
- Express.js
- TypeScript strict mode
- MongoDB with Mongoose
- Zod environment and request validation support
- Pino structured logging
- Helmet, CORS, compression, cookie parsing, rate limiting
- ESLint and Prettier
- Docker and Docker Compose

## Project Structure

```text
src/
  app.ts
  server.ts
  config/
  common/
  modules/
    health/
  routes/
  docs/
  workers/
tests/
docker/
```

Future modules should live under `src/modules/<module-name>` and register routes through `src/routes/index.ts`.

## Local Setup

```bash
cd safespeak-backend
npm install
cp .env.example .env
npm run dev
```

The API expects MongoDB at `MONGODB_URI`. For local development, start MongoDB directly or use Docker Compose.

## Environment Variables

Use `.env.example` as the source of truth. Do not commit `.env` or real secrets.

Required variables:

- `NODE_ENV`
- `PORT`
- `APP_NAME`
- `APP_VERSION`
- `API_PREFIX`
- `CLIENT_URL`
- `ADMIN_URL`
- `MONGODB_URI`
- `LOG_LEVEL`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`

## Scripts

- `npm run dev` - start local development server with `tsx watch`
- `npm run build` - compile TypeScript to `dist`
- `npm start` - run compiled server
- `npm run lint` - run ESLint
- `npm run format` - format files with Prettier
- `npm run format:check` - check formatting
- `npm run typecheck` - run TypeScript without emitting
- `npm test` - placeholder until module tests are added

## Docker Usage

```bash
cp .env.example .env
docker compose up --build
```

Services:

- `api` on `http://localhost:5000`
- `mongodb` on `mongodb://localhost:27017/safespeak`
- Redis is documented in compose as a future-ready optional service and is not wired yet.

## API Base URL

- Local base URL: `http://localhost:5000`
- Versioned API prefix: `/api/v1`

## Health Endpoints

- `GET http://localhost:5000/health`
- `GET http://localhost:5000/api/v1/health`

Health responses include service status, service name, environment, timestamp, uptime, and version.

## Development Standards

- Keep modules isolated under `src/modules`.
- Use `successResponse()` and `errorResponse()` shape consistently.
- Use `ApiError` and centralized error middleware for operational errors.
- Validate environment through `src/config/env.ts`.
- Avoid `console.log`; use the Pino logger.
- Do not introduce business modules until explicitly requested.
- Keep SafeSpeak trauma-informed, consent-first, and privacy-aware in language and data handling.

## Future Module Roadmap

Planned future modules include Auth, Anonymous Session, RBAC, Consent, Profile, Reports, Evidence Vault, AI/RAG legal information, ScamShield, Routing, Admin, Analytics, and Privacy Compliance.

## Safety and Compliance Notes

SafeSpeak is not a crisis service, legal advice provider, counselling service, or case-management system. Future modules should avoid overclaiming, avoid storing unnecessary sensitive data, and preserve user consent, privacy, and control.
