/// Shows whether the server is reachable and ready.
library;

import 'package:dumbbill_mobile/core/network/api_error.dart';
import 'package:dumbbill_mobile/core/providers/core_providers.dart';
import 'package:dumbbill_mobile/core/theme/app_spacing.dart';
import 'package:dumbbill_mobile/core/theme/app_typography.dart';
import 'package:dumbbill_mobile/core/theme/design_tokens.generated.dart';
import 'package:dumbbill_mobile/core/theme/theme_context.dart';
import 'package:dumbbill_mobile/features/system/presentation/system_providers.dart';
import 'package:dumbbill_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Asks the API "are you ready?" (`GET /readyz`) and shows the answer.
///
/// It exists to prove, on the first screen, that the whole chain works: the app, the typed network layer, and the
/// backend with its database. A failure is shown in plain words together with the reference (request id) that finds
/// the same call in the server logs. Never colour alone: the dot sits next to a sentence that says the same thing.
class ServerStatusCard extends ConsumerWidget {
  /// Creates the card.
  const ServerStatusCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = context.colors;
    final status = ref.watch(serverStatusProvider);
    final config = ref.watch(appConfigProvider);

    // What to say and in which tone.
    final (String headline, List<String> lines, String? hint, bool good) = status.when(
      loading: () => (l10n.statusChecking, <String>[], null, true),
      data: (value) => (
        value.ready ? l10n.statusReady : l10n.statusProblem,
        [if (value.databaseUp) l10n.statusDatabaseUp else l10n.statusDatabaseDown],
        null,
        value.ready && value.databaseUp,
      ),
      error: (error, _) {
        if (error is ApiError) {
          return (
            error.isNetwork ? l10n.statusUnreachable : l10n.statusProblem,
            [error.code, l10n.referenceLabel(error.requestId)],
            error.isNetwork ? l10n.statusUnreachableHint : null,
            false,
          );
        }
        return (l10n.statusProblem, <String>[], null, false);
      },
    );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // One announcement for screen readers: the headline and its details together.
            Semantics(
              container: true,
              liveRegion: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      ExcludeSemantics(
                        child: Container(
                          width: 10,
                          height: 10,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: good ? colors.success : colors.danger,
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.s2),
                      Flexible(
                        child: Text(headline, style: Theme.of(context).textTheme.titleMedium),
                      ),
                    ],
                  ),
                  for (final line in lines)
                    Padding(
                      padding: const EdgeInsets.only(top: AppSpacing.s1),
                      child: Text(
                        line,
                        style: AppTypography.code(
                          size: DesignFontSizes.caption,
                        ).copyWith(color: colors.textMuted),
                      ),
                    ),
                  if (hint != null)
                    Padding(
                      padding: const EdgeInsets.only(top: AppSpacing.s2),
                      child: Text(
                        hint,
                        style: Theme.of(
                          context,
                        ).textTheme.bodyMedium?.copyWith(color: colors.textMuted),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.s3),
            Text(
              '${l10n.statusApiAddress}: ${config.apiBaseUrl}',
              style: AppTypography.code(
                size: DesignFontSizes.caption,
              ).copyWith(color: colors.textMuted),
            ),
            if (status.hasError)
              Padding(
                padding: const EdgeInsets.only(top: AppSpacing.s3),
                child: OutlinedButton(
                  onPressed: () => ref.invalidate(serverStatusProvider),
                  child: Text(l10n.tryAgain),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
