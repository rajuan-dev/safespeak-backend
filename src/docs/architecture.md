# Architecture

SafeSpeak Backend follows a modular Express architecture with a small shared platform layer and isolated feature modules.

## Layers

- `src/server.ts` starts the HTTP server, connects infrastructure, and owns graceful shutdown.
- `src/app.ts` composes Express middleware and routes.
- `src/config` owns environment, database, CORS, security, and constants.
- `src/common` contains reusable errors, middleware, responses, utilities, and shared types.
- `src/modules` contains feature modules. Only `health` exists in the foundation phase.
- `src/routes/index.ts` registers versioned API routes.
- `src/workers` is reserved for future Redis/BullMQ workers.

## Foundation Principles

- Consent-first and privacy-aware data handling.
- Centralized validation, logging, responses, and errors.
- No business workflows until explicitly requested.
- Clear module boundaries for future growth.
