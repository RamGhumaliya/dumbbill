/// An amount of money. THE way to show a price or total anywhere in the app.
library;

import 'package:dumbbill_mobile/core/format/money.dart';
import 'package:dumbbill_mobile/core/theme/app_typography.dart';
import 'package:dumbbill_mobile/core/theme/design_tokens.generated.dart';
import 'package:dumbbill_mobile/core/theme/theme_context.dart';
import 'package:flutter/material.dart';

/// How big the amount is drawn.
enum MoneySize {
  /// Prices inside text and lists (monospaced, digits line up).
  inline,

  /// A bill total or a KPI (condensed display face).
  total,

  /// One huge number.
  hero,
}

/// Shows [paise] (whole paise, exactly as the API sends it) with Indian grouping: `12450000` -> `₹1,24,500.00`.
///
/// Negative amounts (refunds, discounts) show a minus sign AND the danger colour: never colour alone.
/// Numbers use tabular figures so columns of prices line up.
class MoneyText extends StatelessWidget {
  /// Creates the widget.
  const MoneyText(
    this.paise, {
    super.key,
    this.size = MoneySize.inline,
    this.trimZeroPaise = false,
    this.muted = false,
  });

  /// Amount in whole paise.
  final int paise;

  /// Text size.
  final MoneySize size;

  /// Show `₹6,694` instead of `₹6,694.00` when there are no paise.
  final bool trimZeroPaise;

  /// Use the secondary text colour.
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final base = switch (size) {
      MoneySize.inline => AppTypography.code(),
      MoneySize.total => AppTypography.numerals(weight: FontWeight.w600),
      MoneySize.hero => AppTypography.numerals(size: DesignFontSizes.hero, height: 1),
    };
    final color = paise < 0 ? colors.danger : (muted ? colors.textMuted : colors.text);
    return Text(
      formatPaise(paise, trimZeroPaise: trimZeroPaise),
      style: base.copyWith(color: color),
      softWrap: false,
    );
  }
}
