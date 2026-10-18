/// The first screen of both apps. A placeholder that proves the foundation works: theme, fonts, translations,
/// the network layer and the server connection. Real screens replace it from Phase 3 and 4.
library;

import 'package:dumbbill_mobile/core/config/app_config.dart';
import 'package:dumbbill_mobile/core/providers/core_providers.dart';
import 'package:dumbbill_mobile/core/theme/app_spacing.dart';
import 'package:dumbbill_mobile/core/theme/theme_context.dart';
import 'package:dumbbill_mobile/core/widgets/theme_mode_selector.dart';
import 'package:dumbbill_mobile/features/home/presentation/customer_sample.dart';
import 'package:dumbbill_mobile/features/home/presentation/owner_sample.dart';
import 'package:dumbbill_mobile/features/system/presentation/server_status_card.dart';
import 'package:dumbbill_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The home screen. It looks slightly different for the owner app and the customer app, chosen by the flavor.
class HomeScreen extends ConsumerWidget {
  /// Creates the screen.
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = context.colors;
    final textTheme = Theme.of(context).textTheme;
    final flavor = ref.watch(appConfigProvider).flavor;
    final isOwner = flavor == AppFlavor.owner;

    return Scaffold(
      appBar: AppBar(title: Text(flavor.displayName.toUpperCase())),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.s4),
          children: [
            // Semantics(header) lets a screen reader jump straight to the title.
            Semantics(
              header: true,
              child: Text(
                (isOwner ? l10n.ownerTitle : l10n.customerTitle).toUpperCase(),
                style: textTheme.headlineMedium,
              ),
            ),
            const SizedBox(height: AppSpacing.s1),
            Text(
              isOwner ? l10n.ownerSubtitle : l10n.customerSubtitle,
              style: textTheme.bodyLarge?.copyWith(color: colors.textMuted),
            ),
            const SizedBox(height: AppSpacing.s6),
            const ThemeModeSelector(),
            const SizedBox(height: AppSpacing.s6),
            if (isOwner) const OwnerSample() else const CustomerSample(),
            const SizedBox(height: AppSpacing.s6),
            Text(
              l10n.statusHeading.toUpperCase(),
              style: textTheme.labelSmall?.copyWith(color: colors.textMuted),
            ),
            const SizedBox(height: AppSpacing.s2),
            const ServerStatusCard(),
          ],
        ),
      ),
    );
  }
}
