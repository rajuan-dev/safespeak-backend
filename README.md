# SafeSpeak Backend

SafeSpeak Backend is the Node.js, Express, TypeScript, and MongoDB foundation for a trauma-informed, multilingual triage and intelligence platform for racism, hate speech, online abuse, scams, discrimination, and related harms in Australia.

This repository currently contains foundation setup only. It intentionally does not implement auth, reports, evidence, AI/RAG, ScamShield, admin APIs, analytics, or business workflows.
Auth, anonymous sessions, RBAC, consent, profile, report foundation, and audit logging are now available as the first data/security foundation modules.

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
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `JWT_REFRESH_EXPIRES_IN`
- `BCRYPT_SALT_ROUNDS`

Optional but deployment-critical notes:

- `ENABLE_ADMIN_SEED` defaults to `false`. Turn it on only when you also provide `DEFAULT_SUPER_ADMIN_EMAIL` and `DEFAULT_SUPER_ADMIN_PASSWORD`.
- For Vercel, set the project Root Directory to `safespeak-backend`.
- For Vercel, configure at least `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_URL`, and `ADMIN_URL` in the project environment variables before deploying.
- For Vercel, the deployment entrypoint is `api/index.js`, which bootstraps the database and then forwards requests to the Express app built into `dist/**`.

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

## Foundation API Endpoints

- Auth: `/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/admin/login`, `/api/v1/auth/refresh`, `/api/v1/auth/logout`, `/api/v1/auth/me`
- Sessions: `/api/v1/sessions/anonymous`, `/api/v1/sessions/current`, `/api/v1/sessions/convert-to-user`
- Consent: `/api/v1/consents/current`, `/api/v1/consents/update`, `/api/v1/consents/withdraw`, `/api/v1/consents/history`
- Profile: `/api/v1/profile`, `/api/v1/languages`, `/api/v1/cultural-profiles`, `/api/v1/faith-profiles`, `/api/v1/community-profiles`
- Reports: `/api/v1/reports` plus report status, timeline, withdraw, delete request, and information-only actions

## Development Standards

- Keep modules isolated under `src/modules`.
- Use `successResponse()` and `errorResponse()` shape consistently.
- Use `ApiError` and centralized error middleware for operational errors.
- Validate environment through `src/config/env.ts`.
- Avoid `console.log`; use the Pino logger.
- Do not introduce AI/RAG, evidence vault, ScamShield, external integrations, analytics, or admin dashboard APIs until explicitly requested.
- Keep SafeSpeak trauma-informed, consent-first, and privacy-aware in language and data handling.

## Future Module Roadmap

Planned future modules include Auth, Anonymous Session, RBAC, Consent, Profile, Reports, Evidence Vault, AI/RAG legal information, ScamShield, Routing, Admin, Analytics, and Privacy Compliance.

## Safety and Compliance Notes

SafeSpeak is not a crisis service, legal advice provider, counselling service, or case-management system. Future modules should avoid overclaiming, avoid storing unnecessary sensitive data, and preserve user consent, privacy, and control.
