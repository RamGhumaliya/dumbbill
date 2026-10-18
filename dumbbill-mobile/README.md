# dumbbill-mobile

The Flutter apps for Dumbbill. **Two apps, one codebase**:

| App | Who it is for | Entry point | Android id |
|---|---|---|---|
| Owner | the shop owner (sales, stock, profit on the go) | `lib/main_owner.dart` | `in.dumbbill.owner` |
| Customer | the shopper (shops joined, points, offers) | `lib/main_customer.dart` | `in.dumbbill.customer` |

Each app comes in two environments only, **dev** and **prod** (there is no staging). The dev builds add `.dev` to the id and name, so dev and prod can sit on the same phone. That gives four Android flavors: `ownerDev`, `ownerProd`, `customerDev`, `customerProd`.

Right now both apps show a placeholder home screen: the design system, a labelled sample card, and a live "Server is ready" check against the API. Real features start in Phase 1 (see `docs/05-ai-kit/prompts/`).

## What you need

- Flutter (stable or newer) with the Android SDK, and an Android emulator or a phone.
- The API running on your machine (`docs/runbooks/local-setup.md`, steps 4 to 6).
- For the font and token tools only: Python with `fonttools` and `brotli` (fonts) and nothing extra for tokens (they use Dart).
- iOS needs a Mac. The iOS project exists, but its dev/prod schemes are not set up yet (see "iOS" below).

## Run it

```bash
cd dumbbill-mobile
flutter pub get
dart run build_runner build          # makes the *.g.dart and *.freezed.dart files (they are not committed)

# Owner app, dev, on a running emulator
flutter run --flavor ownerDev -t lib/main_owner.dart --dart-define-from-file=config/dev.json

# Customer app, dev
flutter run --flavor customerDev -t lib/main_customer.dart --dart-define-from-file=config/dev.json
```

`config/dev.json` points the app at `http://10.0.2.2:3000`. On the Android emulator that address means "the computer the emulator runs on", which is where your API listens. On a real phone use your computer's wifi address instead (see `config/README.md`).

If a fresh clone shows errors about missing `*.g.dart` files, you skipped `dart run build_runner build`.

## Configuration

Settings are passed at build time with `--dart-define-from-file`, never baked into the source. See `config/README.md` for the keys and for how the prod file is made. Nothing secret belongs in these files: an app on a phone can always be unpacked.

## Checks (run before every commit)

```bash
flutter analyze                      # strict rules (very_good_analysis); must say "No issues found"
flutter test                         # 83 tests
dart run tool/generate_tokens.dart --check    # the generated colours still match docs/02-design/tokens/tokens.json
```

What the tests cover: the network layer (request ids, one token refresh on 401, error mapping), config parsing, rupee formatting, the offline cache, both themes, the data path of the sample feature, the home screen of both apps, and Flutter's accessibility guidelines (tap size, labels, text contrast) in light and dark.

## Design tokens and fonts

Colours, sizes and type come from the one shared file `docs/02-design/tokens/tokens.json`, the same file the web app uses.

```bash
dart run tool/generate_tokens.dart            # rewrites lib/core/theme/design_tokens.generated.dart
```

The generator runs the same 54 contrast checks as the web app and refuses to write if one fails. The generated file **is committed** (a test fails if it is out of date). Never edit it by hand; change `tokens.json` and regenerate.

Fonts live in `assets/fonts/`, converted from the web's font files by `tool/convert_fonts.py`. Only Inter Tight has the rupee sign, so the numeral and code styles fall back to it (see `lib/core/theme/app_typography.dart`).

## Code map

```
lib/
  main_owner.dart, main_customer.dart   entry points; each only picks the flavor and calls bootstrap
  app/                                   bootstrap (error reporting, providers) and the root widget
  core/
    config/                              AppConfig: reads the build-time settings and checks them
    theme/                               generated tokens, typography, light/dark themes, theme switch state
    network/                             dio setup, interceptors, token storage, error mapping
    storage/                             drift database (local cache)
    observability/                       Sentry (off unless a DSN is given)
    providers/                           shared providers; provider_policy.dart (no automatic retry)
    router/                              go_router
    format/                              money formatting (display only, paise -> ₹ with Indian grouping)
    widgets/                             shared widgets
  features/<feature>/{data,domain,presentation}
                                         the "system" feature is the worked example of the pattern
  l10n/                                  app_en.arb (all user-facing text) and generated localisations
```

Rules that matter (full list in `CLAUDE.md`): screens never call dio directly; money is never calculated on the device; every user-facing string is in the ARB file; no raw colours or sizes in widgets.

## Good to know

- **Riverpod automatic retry is switched off** (`noAutomaticRetry`). A failed read shows its error at once with a "Try again" button, and a write is never repeated silently. This matters for bills and payments.
- **The theme choice is not remembered** between launches yet. That arrives with the settings screen in Phase 4.
- **Android needs 8.0 (API 26) or newer**, because the error-tracking library requires it.
- The project sits on drive D: while Flutter's package cache is on C:. Kotlin's incremental compiler cannot handle that, so `android/gradle.properties` turns it off. If you see "Could not close incremental caches", check that setting.
- This was built with a pre-release Flutter SDK (3.50 dev). When you move to a stable release, run `flutter analyze` and `flutter test` and fix whatever the upgrade shows.

## iOS

The iOS project is generated but has no `dev`/`prod` schemes yet; that needs Xcode on a Mac. When you have one: create schemes and build configurations named `dev` and `prod` (only these two), set the bundle ids `in.dumbbill.owner` / `in.dumbbill.customer` (+`.dev`), and the display names to match Android. Until then, only Android builds are supported.

## Releases

Manual, by decision. Build with the `prod` flavor and `config/prod.json` (see `config/README.md`). Signing keys are never committed (`*.jks`, `key.properties` are git-ignored).
