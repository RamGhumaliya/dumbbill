/// A preview of a shop card in the customer app, with clearly labelled sample content.
library;

import 'package:dumbbill_mobile/core/format/money.dart';
import 'package:dumbbill_mobile/core/theme/app_spacing.dart';
import 'package:dumbbill_mobile/core/theme/app_typography.dart';
import 'package:dumbbill_mobile/core/theme/design_tokens.generated.dart';
import 'package:dumbbill_mobile/core/theme/theme_context.dart';
import 'package:dumbbill_mobile/features/home/presentation/sample_notice.dart';
import 'package:dumbbill_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';

/// SAMPLE content that exists only to show the layout of the future shop card. Labelled as a sample on screen.
const _points = 420;
const _pointsWorthPaise =
    21000; // 100 points = Rs 50 (the default loyalty rule), so 420 points ~ Rs 210

/// One membership card: the shop, the points balance, and an offer.
class CustomerSample extends StatelessWidget {
  /// Creates the preview.
  const CustomerSample({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = context.colors;
    final textTheme = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.customerSampleHeading.toUpperCase(),
          style: textTheme.labelSmall?.copyWith(color: colors.textMuted),
        ),
        const SizedBox(height: AppSpacing.s2),
        const SampleNotice(),
        const SizedBox(height: AppSpacing.s3),
        // The accent-coloured card is the one thing to look at on this screen.
        DecoratedBox(
          decoration: BoxDecoration(
            color: colors.accent,
            borderRadius: BorderRadius.circular(DesignRadius.card),
          ),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s4),
            child: Semantics(
              container: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.customerSampleShop,
                    style: textTheme.titleMedium?.copyWith(color: colors.accentOn),
                  ),
                  const SizedBox(height: AppSpacing.s4),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        '$_points',
                        style: AppTypography.numerals(
                          size: DesignFontSizes.display,
                          height: 1,
                        ).copyWith(color: colors.accentOn),
                      ),
                      const SizedBox(width: AppSpacing.s2),
                      Text(
                        l10n.customerSamplePointsLabel,
                        style: textTheme.bodyMedium?.copyWith(color: colors.accentOn),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.s1),
                  Text(
                    l10n.customerSamplePointsWorth(
                      formatPaise(_pointsWorthPaise, trimZeroPaise: true),
                    ),
                    style: textTheme.bodySmall?.copyWith(color: colors.accentOn),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.s3),
        // An offer: a plain bordered row, not a coloured pill.
        DecoratedBox(
          decoration: BoxDecoration(
            color: colors.bgSurface,
            border: Border.all(color: colors.border),
            borderRadius: BorderRadius.circular(DesignRadius.card),
          ),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s4),
            child: Semantics(
              container: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.customerSampleOffer, style: textTheme.titleSmall),
                  const SizedBox(height: AppSpacing.s1),
                  Text(
                    l10n.customerSampleOfferExpiry,
                    style: textTheme.bodySmall?.copyWith(color: colors.textMuted),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
