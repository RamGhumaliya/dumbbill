# Logging, Errors and Tracing (how to use them)

Everything here is built into the backend (step P0-3). This page explains it in plain words and shows what to write in new code.

## 1. The request id: the thread that ties everything together

Every API call gets an id such as `01JA3K9Q8M2T7XW4Z6B1C5D0EF`.

- It is returned in the `X-Request-Id` header of **every** response, and in the `requestId` field of every error body.
- It is written on **every log line** of that request.
- It is attached to the report sent to Sentry for unexpected errors.

So when a cashier says "I got an error, reference 01JA3K…", search the logs for that id and you see the whole story.

The web and mobile apps may send their own `X-Request-Id` (8 to 64 letters, digits, `.`, `_`, `-`) so one id follows an action from the screen to the server. Anything else is ignored and replaced.

## 2. Reading logs

In development, logs are coloured one-liners. In production, each line is one JSON object:

```json
{"level":"warn","time":"2026-10-16T14:37:43.600Z","service":"dumbbill-api","env":"production","version":"1.0.0",
 "requestId":"01JA…","tenantId":"…","req":{"method":"GET","path":"/v1/products"},"res":{"statusCode":404},
 "responseTime":5,"msg":"request completed"}
```

| Field | Meaning |
|---|---|
| `level` | `fatal` the process is dying, `error` unexpected failure, `warn` client mistake or security event, `info` normal, `debug` detail (off in production) |
| `service`, `env`, `version` | which program and release wrote the line |
| `requestId` | the thread described above |
| `tenantId`, `userId` | which business, and a one-way fingerprint of the user (not the real id). Present once the request is authenticated |
| `traceId`, `spanId` | link to the trace, when tracing is on (section 5) |
| `req.path` | the path only: no query string, no headers, no body, on purpose |

Set how much is written with `LOG_LEVEL` in `.env`.

### What is never written to logs

A safety net removes these from **any** log call, at any depth, whatever the developer logged (`src/common/logging/redaction.ts`):

- passwords, tokens, cookies, `Authorization`, PINs, OTPs, secrets, API keys (any field name ending in `password`, `token` or `secret` too)
- purchase cost, WAC, cost of goods, profit and margin (a cashier is never allowed to see them, so logs must not carry them)
- email and phone are shortened (`r***@example.com`, `******3210`)

**Limit to remember:** the text inside an error **message** is not scanned. Never put a secret or a customer's private data in the message of an error you throw.

### Writing log lines in code

Inject the logger and put the message **inside the object** (the Nest logger treats a trailing text argument as a "context"):

```ts
constructor(private readonly logger: Logger) {}   // from 'nestjs-pino'

this.logger.log({ msg: 'Invoice created', invoiceId, branchId });   // info
this.logger.warn({ msg: 'Discount rejected', code: 'DISCOUNT_EXCEEDS_LIMIT' });
```

Log business events (invoice created, discount rejected, approval granted, stock adjusted), not just failures. Do not log whole request bodies. Never use `console.log` (lint blocks it).

## 3. Errors: one format for everything

Every failed request returns the same body (`application/problem+json`, RFC 9457):

```json
{ "type": "https://api.dumbbill.in/errors/discount-exceeds-limit", "title": "Discount exceeds your limit",
  "status": 422, "code": "DISCOUNT_EXCEEDS_LIMIT", "detail": "Maximum allowed is 5%.",
  "requestId": "01JA…", "errors": [{ "field": "discount.value", "message": "must not be greater than 5" }] }
```

The list of codes, what each means, and what the apps should do: **`docs/api/error-codes.md`** (generated, for the web and mobile developers).

### Throwing errors in code

```ts
import { DomainError } from '../../common/errors/domain-error';

throw new DomainError('DISCOUNT_EXCEEDS_LIMIT', 'Maximum allowed is 5%.');   // expected problem the caller can fix
```

- Use `DomainError` for problems the caller should know about. Status and title come from the catalogue.
- Let real bugs just throw. They become a safe `500 INTERNAL_ERROR` that reveals nothing (no stack, SQL or file names), are logged with the full stack, and are sent to Sentry.
- A database refusal because the row belongs to **another business** is answered as `404 NOT_FOUND` (never confirms the other row exists) and logged as a security warning (`event: "rls.violation"`).
- Invalid input is automatically reported as `400 VALIDATION_FAILED` with one entry per field; the rejected value is never echoed.

### Adding a new error code

1. Add one line to `src/common/errors/error-codes.ts` (status, title, what the app should do).
2. `pnpm docs:errors` and commit the updated `docs/api/error-codes.md`. A test fails if you forget.

### Documenting errors in Swagger

```ts
@ApiProblemResponse('NOT_FOUND', { detail: 'No product with this id.' })
@ApiProblemResponse('VALIDATION_FAILED', { errors: [{ field: 'name', message: 'should not be empty' }] })
```

A test (`test/integration/swagger-completeness.spec.ts`) fails, naming the route, if any endpoint lacks tags, a unique operation id, a summary, a description with a `Permission:` line, a success response, documented errors with examples, or the errors that must exist for its kind (401/403 when protected, 404 with a path parameter, 400 with a body).

## 4. Sentry (error tracking)

- Off unless `SENTRY_DSN` is set. Nothing is sent in development or tests.
- Only unexpected failures (HTTP 500 and above) are reported. "Not found" or "invalid field" are normal and not reported.
- Each report is tagged with `requestId`, `tenantId` and `code`.
- Sentry 11 collects cookies, headers, bodies, query strings and user info by default, so the code turns all of them off and strips them again before sending.

To switch it on: put the project's address in `SENTRY_DSN` and set `APP_VERSION` to the release.

## 5. Tracing (OpenTelemetry)

Shows how long each step of a request took.

- `OTEL_EXPORTER=none` (default): off, no overhead.
- `OTEL_EXPORTER=console`: every finished step is printed in the terminal, and log lines gain a `traceId`. Good for finding why a request is slow.
- Sending traces to a real service (CloudWatch/X-Ray and so on) is added when the app is deployed.

## 6. Quick recipes

| I want to... | Do this |
|---|---|
| Find everything about one failed request | Search the logs for its `requestId` |
| See all unexpected errors | Filter logs for `level` = `error`, or look in Sentry |
| See attempts to reach another business's data | Filter logs for `event` = `rls.violation` |
| Debug a slow endpoint | Set `OTEL_EXPORTER=console`, repeat the request, read the span durations |
| Check a log sample for leaks | Parse the line and pass it to `findLeakedSecrets()` (`src/common/logging/redaction.ts`) |
