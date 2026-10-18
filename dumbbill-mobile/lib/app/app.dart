/// The root widget: theme, translations, navigation.
library;

import 'package:dumbbill_mobile/core/providers/core_providers.dart';
import 'package:dumbbill_mobile/core/router/app_router.dart';
import 'package:dumbbill_mobile/core/theme/app_theme.dart';
import 'package:dumbbill_mobile/core/theme/theme_mode_controller.dart';
import 'package:dumbbill_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The whole app. Dark is "Iron Ledger", light is "Quiet Ledger"; the user picks System, Dark or Light.
class DumbbillApp extends ConsumerWidget {
  /// Creates the app.
  const DumbbillApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final flavor = ref.watch(appConfigProvider).flavor;
    return MaterialApp.router(
      // The title shown in the phone's app switcher.
      onGenerateTitle: (_) => flavor.displayName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ref.watch(themeModeControllerProvider),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      routerConfig: ref.watch(appRouterProvider),
    );
  }
}
