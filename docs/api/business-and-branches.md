# Business profile and branches: guide for app developers

For web and mobile developers. The Swagger manual (`/docs`, tags **Tenants & Business** and **Branches**) lists every field; this page explains how the pieces fit together. Reasoning: `docs/adr/010-business-profile-and-branches.md`.

## Who may call what

| Endpoint | Who |
|---|---|
| `GET /v1/business`, `GET /v1/business/logo`, `GET /v1/business/gst-states` | any signed-in person |
| `GET /v1/branches`, `GET /v1/branches/{branchId}` | any signed-in person, only branches they may use |
| `PUT /v1/business`, `PUT/DELETE /v1/business/logo`, `GET /v1/business/onboarding` | `settings.manage` |
| `POST /v1/branches`, `PUT /v1/branches/{id}`, `POST /v1/branches/{id}/deactivate`, `/activate` | `settings.manage` |

Screens should hide what the person cannot do (read `access.permissions` from login or `/v1/auth/me`), but the API refuses it anyway with `403 FORBIDDEN`.

## The profile

`PUT /v1/business` replaces the whole profile:

```json
{ "name": "FitFuel Nutrition", "stateCode": "27", "gstin": "27AAPFU0939F1ZV",
  "addressLine": "12, Ganesh Peth", "city": "Pune", "pincode": "411002", "phone": "+919822012345" }
```

- `stateCode` is required (two digits, from `GET /v1/business/gst-states`). It decides CGST + SGST versus IGST.
- `gstin`, `addressLine`, `city`, `pincode`, `phone` are optional. Send `null` or an empty string for "none".
- The server tidies what it can: a GSTIN is upper-cased and spaces removed, a phone loses spaces and dashes.
- Field problems come back as `400 VALIDATION_FAILED` with `errors[]` (`{ field, message }`), to show next to each box. A GSTIN can fail on its shape, its **check character** (a typing mistake), or because it does not start with the chosen state code.
- `422 BUSINESS_RULE_VIOLATION`: a branch already has a GSTIN with a different PAN (characters 3 to 12). Show `detail`.
- No GSTIN is allowed. Show a warning that only bills of supply can be issued until one is added.

### Logo

`PUT /v1/business/logo` takes `multipart/form-data` with one field `file` (PNG, JPEG or WebP, up to 2 MB). Errors: `415 FILE_TYPE_NOT_ALLOWED`, `422 FILE_CONTENT_MISMATCH` (the bytes are not that image), `422 FILE_EMPTY`, `413 PAYLOAD_TOO_LARGE`. The profile's `hasLogo` says whether one exists.

`GET /v1/business/logo` needs the bearer token, so an `<img src>` link cannot fetch it. Download it with the API client and show it from memory (the web app reads it as a Blob and shows a `data:` address). `404 NOT_FOUND` when there is none.

## Branches

`POST /v1/branches` and `PUT /v1/branches/{id}` take the same body:

```json
{ "name": "Kothrud shop", "invoicePrefix": "KOT", "printerWidthMm": 80, "stateCode": "27",
  "gstin": null, "addressLine": "45, Paud Road", "city": "Pune", "pincode": "411038", "phone": null }
```

- `invoicePrefix`: 1 to 6 capital letters or digits (the server upper-cases it). Unique inside the business. Printed at the start of every invoice number of the branch.
- `printerWidthMm`: `58` or `80`.
- A branch GSTIN must start with the branch's state code and share the business GSTIN's PAN.
- `409 CONFLICT` with `errors[]` naming `invoicePrefix` or `name` when another branch already has it. (Show the message under that box.)
- `422 PLAN_LIMIT_REACHED`: the plan's active-branch limit is used up. Show `detail` and offer an upgrade (billing arrives in Phase 4).

`GET /v1/branches` returns `{ branches, limit: { max, used } }`: active branches first, then switched-off ones, restricted to the branches the person may use. `limit.used` counts only active branches.

`POST /v1/branches/{id}/deactivate` switches a branch off (history kept). The last active branch cannot be switched off: `422 BUSINESS_RULE_VIOLATION`. `POST /v1/branches/{id}/activate` switches it back on and checks the plan limit again. Both are safe to repeat.

A branch of another business answers `404 NOT_FOUND` (never 403, so ids cannot be probed). A branch of your own business that your role may not use answers `403 FORBIDDEN` on `GET /v1/branches/{id}`.

## First-steps checklist

`GET /v1/business/onboarding` returns `{ steps: [{ key: "PROFILE" | "BRANCH" | "TEAM", done }], gstinMissing }`. A step is done when real data proves it (profile has state and address; an active branch has state and address; a second person is on the team). More step keys will appear as later modules add them, so ignore keys you do not know.

## Audit

`business.profile_updated`, `business.logo_changed`, `business.logo_removed`, `branch.created`, `branch.updated`, `branch.deactivated`, `branch.activated`. Updates record the names of the changed fields in `metadata.changedFields`, never the values.
