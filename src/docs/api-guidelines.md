# API Guidelines

## Base URLs

- Root health: `GET /health`
- Versioned API: `/api/v1`
- Versioned health: `GET /api/v1/health`

## Responses

Use the shared helpers in `src/common/responses/api-response.ts`.

Success responses:

```json
{
  "success": true,
  "message": "Service is healthy",
  "data": {},
  "meta": {}
}
```

Error responses:

```json
{
  "success": false,
  "message": "Route not found",
  "requestId": "request-id",
  "errors": []
}
```

## Validation

Use Zod schemas with `validate.middleware.ts` for params, query, and body validation.

## Errors

Use `ApiError` for expected operational errors and allow the global error middleware to format the response.
