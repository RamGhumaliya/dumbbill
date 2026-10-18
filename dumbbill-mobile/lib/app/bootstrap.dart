/// Start-up shared by both apps. Each `main_*.dart` only says which app it is.
library;

import 'package:dumbbill_mobile/app/app.dart';
import 'package:dumbbill_mobile/core/config/app_config.dart';
import 'package:dumbbill_mobile/core/observability/error_reporting.dart';
import 'package:dumbbill_mobile/core/providers/core_providers.dart';
import 'package:dumbbill_mobile/core/providers/provider_policy.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Reads the settings, switches on error reporting (if configured) and runs the app.
///
/// If the settings are missing or wrong, a plain explanation is shown instead of a crash or a blank screen, because
/// this is a developer mistake (a forgotten `--dart-define-from-file`) that should be obvious at once.
Future<void> bootstrap(AppFlavor flavor) async {
  WidgetsFlutterBinding.ensureInitialized();

  final AppConfig config;
  try {
    config = AppConfig.fromEnvironment(flavor);
  } on AppConfigException catch (error) {
    runApp(_ConfigErrorApp(message: error.message));
    return;
  }

  await runWithErrorReporting(
    config,
    () => runApp(
      ProviderScope(
        retry: noAutomaticRetry,
        overrides: [appConfigProvider.overrideWithValue(config)],
        child: const DumbbillApp(),
      ),
    ),
  );
}

/// Shown only when the build settings are wrong. Developer-facing, so it is plain English and not translated.
class _ConfigErrorApp extends StatelessWidget {
  const _ConfigErrorApp({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: SingleChildScrollView(child: SelectableText(message)),
          ),
        ),
      ),
    );
  }
}
