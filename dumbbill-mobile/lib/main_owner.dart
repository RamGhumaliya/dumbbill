/// Entrypoint of the OWNER app: dashboards, stock alerts and approvals for shop owners and managers.
///
/// Run (dev):  flutter run --flavor ownerDev -t lib/main_owner.dart --dart-define-from-file=config/dev.json
library;

import 'package:dumbbill_mobile/app/bootstrap.dart';
import 'package:dumbbill_mobile/core/config/app_config.dart';

/// Starts the owner app.
Future<void> main() => bootstrap(AppFlavor.owner);
