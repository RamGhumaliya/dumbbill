# dumbbill-mobile – Rules

Flutter (Dart, null-safe) · Riverpod 3 + riverpod_generator · dio + retrofit · freezed + json_serializable · go_router · flutter_secure_storage · drift · intl (ARB) · sentry_flutter · flutter_test.
Two apps from one codebase via entrypoints: `owner` and `customer` (`lib/main_owner.dart`, `lib/main_customer.dart`). Build flavors: **`dev` and `prod` only**.
Read `../CLAUDE.md`, `../docs/02-design/design-guide.md`, `../docs/03-engineering/standards.md` (Mobile).

## Architecture: feature-first + clean-lite
```
lib/
  core/        theme (generated from tokens), network (dio, interceptors, auth refresh), storage, errors, l10n, router, widgets
  features/<feature>/
    data/          api (retrofit), dto (freezed), repositories impl, local (drift)
    domain/        entities, repository interfaces, small use-cases only when logic exists
    presentation/  providers (riverpod notifiers), screens, widgets
```
Rules: UI never calls dio directly; screens watch providers; providers call repositories; repositories map DTO → entity. No business-money math on device (display only).

## Rules
- Theme: dark = Iron Ledger, light = Quiet Ledger, via `ThemeExtension` tokens; no hard-coded colors/sizes in widgets.
- Tokens in secure storage; refresh on 401 once, then logout. Handle offline/slow network states on every list screen.
- QR screen: brightness boost + rotating token. Semantics labels on interactive widgets. const widgets, `RepaintBoundary` for animation, 60 fps.
- Tests: `flutter_test` for providers/repositories/widgets; manual emulator testing checklist in `docs/04-qa/`. Releases are manual.

## Comments (mandatory)
Follow the "Comments" section of `../CLAUDE.md`: file purpose, a doc comment on every exported symbol, and the *why* behind business rules, security choices and non-obvious code, in plain English.

## Commands and gotchas
- Checks before commit: `flutter analyze` (must be clean), `flutter test`, `dart run tool/generate_tokens.dart --check`. After editing annotated files run `dart run build_runner build` (generated `*.g.dart`/`*.freezed.dart` are not committed).
- Run: `flutter run --flavor ownerDev -t lib/main_owner.dart --dart-define-from-file=config/dev.json` (or `customerDev` / `lib/main_customer.dart`). Details in `README.md`.
- `lib/core/theme/design_tokens.generated.dart` is generated from `docs/02-design/tokens/tokens.json`; never edit by hand.
- Riverpod automatic retry is OFF (`noAutomaticRetry`); writes are never retried silently. Min Android 8 (API 26). Keep `kotlin.incremental=false` (project on D:, pub cache on C:).
- Only Android flavors exist; iOS dev/prod schemes need a Mac and are a manual step.
