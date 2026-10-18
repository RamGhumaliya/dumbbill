# Build-time settings

These JSON files are passed to Flutter with `--dart-define-from-file`. The app reads them in `lib/core/config/app_config.dart`, which refuses to start with a clear message if something is missing or wrong.

| Key | Required | Meaning |
|---|---|---|
| `ENV` | yes | `dev` or `prod`. Only these two exist. |
| `API_BASE_URL` | yes | Address of the Dumbbill API, with no trailing slash. In `prod` it must start with `https://`. |
| `SENTRY_DSN` | no | Error-tracking address. Leave it out and error reporting stays off. |
| `APP_VERSION` | no | Shown in error reports. Defaults to `dev`. Set it for release builds (for example `1.0.0`). |

## Files

| File | In git? | Use |
|---|---|---|
| `dev.json` | yes | Local development. Holds no secrets, only `10.0.2.2:3000`. |
| `prod.example.json` | yes | Template for the real prod file. |
| `prod.json` | **no** (git-ignored) | Copy of the template with the real values. Owned by the product owner. |

## Which address for dev?

- **Android emulator:** `http://10.0.2.2:3000` (the emulator's name for your computer). Already in `dev.json`.
- **A real phone on your wifi:** `http://<your computer's wifi address>:3000`, for example `http://192.168.1.20:3000`. Make a local copy of `dev.json` for this (do not commit it) and allow the port through the Windows firewall.
- Plain `http://` is allowed only in dev builds (`android/app/src/dev/AndroidManifest.xml`). Prod builds block it.

## Build a prod APK (manual release)

```bash
cp config/prod.example.json config/prod.json      # then edit the values
flutter build apk --release --flavor ownerProd -t lib/main_owner.dart --dart-define-from-file=config/prod.json
```
