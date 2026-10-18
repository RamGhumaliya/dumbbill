/// The text styles of the app, built from the design tokens.
///
/// One type system for both themes (design guide section 0):
///   - [AppTypography.ui]        Inter Tight: interface text
///   - [AppTypography.numerals]  Barlow Condensed: totals, big numbers, headings
///   - [AppTypography.code]      JetBrains Mono: prices in tables, SKUs, barcodes
///
/// **The rupee sign:** only Inter Tight contains the rupee symbol (U+20B9). Barlow Condensed and JetBrains Mono do
/// not, so their `fontFamilyFallback` ends with Inter Tight. Otherwise every price would use a random system font for
/// its rupee sign next to our own digits. (The web app does the same in its font stacks.)
library;

import 'package:dumbbill_mobile/core/theme/design_tokens.generated.dart';
import 'package:flutter/widgets.dart';

/// Builds [TextStyle]s with the product's fonts, sizes and weights. Colours are NOT set here: text takes its colour
/// from the theme, so a style works in both light and dark.
abstract final class AppTypography {
  // Fallback chains. Each font is two families (latin and latin-ext) because Flutter has no per-character files.
  static const List<String> _uiFallback = [DesignFonts.uiExt];
  static const List<String> _numeralsFallback = [
    DesignFonts.numeralsExt,
    DesignFonts.ui,
    DesignFonts.uiExt,
  ];
  static const List<String> _codeFallback = [
    DesignFonts.codeExt,
    DesignFonts.ui,
    DesignFonts.uiExt,
  ];

  /// Interface text.
  static TextStyle ui({
    double size = DesignFontSizes.body,
    FontWeight weight = FontWeight.w400,
    double? height,
    double letterSpacing = 0,
  }) {
    return TextStyle(
      fontFamily: DesignFonts.ui,
      fontFamilyFallback: _uiFallback,
      fontSize: size,
      fontWeight: weight,
      // Inter Tight is a variable font: ask for the exact weight on its weight axis.
      fontVariations: [FontVariation.weight(weight.value.toDouble())],
      fontFeatures: const [FontFeature.tabularFigures()],
      height: height,
      letterSpacing: letterSpacing,
    );
  }

  /// Totals, big numbers and headings: condensed, bold, upright. Barlow Condensed ships Medium, SemiBold and Bold only.
  static TextStyle numerals({
    double size = DesignFontSizes.heading,
    FontWeight weight = FontWeight.w700,
    double? height,
    double letterSpacing = 0,
  }) {
    return TextStyle(
      fontFamily: DesignFonts.numerals,
      fontFamilyFallback: _numeralsFallback,
      fontSize: size,
      fontWeight: weight,
      fontFeatures: const [FontFeature.tabularFigures()],
      height: height,
      letterSpacing: letterSpacing,
    );
  }

  /// Prices in tables, SKUs and barcodes: monospaced so digits line up.
  static TextStyle code({
    double size = DesignFontSizes.small,
    FontWeight weight = FontWeight.w500,
    double? height,
  }) {
    return TextStyle(
      fontFamily: DesignFonts.code,
      fontFamilyFallback: _codeFallback,
      fontSize: size,
      fontWeight: weight,
      fontVariations: [FontVariation.weight(weight.value.toDouble())],
      fontFeatures: const [FontFeature.tabularFigures()],
      height: height,
    );
  }
}
