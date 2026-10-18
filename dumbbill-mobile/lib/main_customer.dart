/// Entrypoint of the CUSTOMER app: join shops, see offers, collect points, show the membership QR.
///
/// Run (dev):  flutter run --flavor customerDev -t lib/main_customer.dart --dart-define-from-file=config/dev.json
library;

import 'package:dumbbill_mobile/app/bootstrap.dart';
import 'package:dumbbill_mobile/core/config/app_config.dart';

/// Starts the customer app.
Future<void> main() => bootstrap(AppFlavor.customer);
