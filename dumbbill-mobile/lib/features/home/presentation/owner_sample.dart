/// A preview of the owner dashboard layout, with clearly labelled sample figures.
library;

import 'package:dumbbill_mobile/core/theme/app_spacing.dart';
import 'package:dumbbill_mobile/core/theme/app_typography.dart';
import 'package:dumbbill_mobile/core/theme/theme_context.dart';
import 'package:dumbbill_mobile/core/widgets/money_text.dart';
import 'package:dumbbill_mobile/features/home/presentation/sample_notice.dart';
import 'package:dumbbill_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';

/// SAMPLE figures that exist only to show the layout of the future dashboard. They are labelled as samples on screen
/// and replaced by real report data in Phase 4. Money is in paise.
const _salesPaise = 18426000; // Rs 1,84,260.00
const _bills = 61;
const _profitPaise = 3890000; // Rs 38,900.00
const _lowStock = 7;

/// The four headline numbers of a day, in a two-by-two grid under a hard rule.
class OwnerSample extends StatelessWidget {
  /// Creates the preview.
  const OwnerSample({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = context.colors;
    final numeral = AppTypography.numerals(weight: FontWeight.w600).copyWith(color: colors.text);

    Widget cell(String label, Widget value) {
      return Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.s3),
          // The label and its value are read together by a screen reader ("Sales today, 1,84,260 rupees").
          child: Semantics(
            container: true,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.textMuted),
                ),
                const SizedBox(height: AppSpacing.s1),
                value,
              ],
            ),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.ownerSampleHeading.toUpperCase(),
          style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.textMuted),
        ),
        const SizedBox(height: AppSpacing.s2),
        const SampleNotice(),
        const SizedBox(height: AppSpacing.s3),
        // The hard 2 px rule above the KPI strip (design guide).
        Container(height: 2, color: colors.borderStrong),
        Row(
          children: [
            cell(
              l10n.ownerSampleSales,
              const MoneyText(_salesPaise, size: MoneySize.total, trimZeroPaise: true),
            ),
            cell(l10n.ownerSampleBills, Text('$_bills', style: numeral.copyWith(fontSize: 28))),
          ],
        ),
        Divider(color: colors.border),
        Row(
          children: [
            cell(
              l10n.ownerSampleProfit,
              const MoneyText(_profitPaise, size: MoneySize.total, trimZeroPaise: true),
            ),
            cell(
              l10n.ownerSampleLowStock,
              Text('$_lowStock', style: numeral.copyWith(fontSize: 28)),
            ),
          ],
        ),
        Divider(color: colors.border),
      ],
    );
  }
}
