/// The small label that marks a preview as made-up data.
library;

import 'package:dumbbill_mobile/core/theme/app_spacing.dart';
import 'package:dumbbill_mobile/core/theme/design_tokens.generated.dart';
import 'package:dumbbill_mobile/core/theme/theme_context.dart';
import 'package:dumbbill_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';

/// "Sample figures for layout only. Not real data." in the warning-tag style (meaning is in the words, not the colour).
class SampleNotice extends StatelessWidget {
  /// Creates the label.
  const SampleNotice({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.tagBg,
        borderRadius: BorderRadius.circular(DesignRadius.control),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s2, vertical: AppSpacing.s1),
        child: Text(
          AppLocalizations.of(context).sampleNotice,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(color: colors.tagText),
        ),
      ),
    );
  }
}
