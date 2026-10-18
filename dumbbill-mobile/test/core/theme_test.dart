import 'package:dumbbill_mobile/core/theme/app_theme.dart';
import 'package:dumbbill_mobile/core/theme/app_typography.dart';
import 'package:dumbbill_mobile/core/theme/design_tokens.generated.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// WCAG contrast between two Flutter colours (the same maths the token generator uses on hex strings).
double ratio(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  return (la > lb ? la + 0.05 : lb + 0.05) / (la > lb ? lb + 0.05 : la + 0.05);
}

void main() {
  group('the two themes', () {
    test('dark is Iron Ledger (ink and volt), light is Quiet Ledger (warm white and teal)', () {
      expect(DumbbillColors.dark.accent, const Color(0xFFC6F432));
      expect(DumbbillColors.dark.bgBase, const Color(0xFF0E0F11));
      expect(DumbbillColors.light.accent, const Color(0xFF0F5C5C));
      expect(DumbbillColors.light.bgBase, const Color(0xFFFBFAF8));
    });

    for (final (name, theme, colors, brightness) in [
      ('dark', AppTheme.dark(), DumbbillColors.dark, Brightness.dark),
      ('light', AppTheme.light(), DumbbillColors.light, Brightness.light),
    ]) {
      group(name, () {
        test('carries the design colours as a theme extension', () {
          expect(theme.extension<DumbbillColors>(), same(colors));
          expect(theme.brightness, brightness);
        });

        test('maps the tokens onto Material (page, surface, accent, error)', () {
          expect(theme.scaffoldBackgroundColor, colors.bgBase);
          expect(theme.colorScheme.surface, colors.bgSurface);
          expect(theme.colorScheme.primary, colors.accent);
          expect(theme.colorScheme.onPrimary, colors.accentOn);
          expect(theme.colorScheme.error, colors.danger);
        });

        test('body text is readable on every surface it sits on (WCAG 4.5:1)', () {
          for (final surface in [colors.bgBase, colors.bgSurface, colors.bgSide]) {
            expect(ratio(colors.text, surface), greaterThanOrEqualTo(4.5));
            expect(ratio(colors.textMuted, surface), greaterThanOrEqualTo(4.5));
          }
          expect(ratio(colors.accentOn, colors.accent), greaterThanOrEqualTo(4.5));
        });

        test('controls meet the minimum tap height and have the two design radii only', () {
          final filled = theme.filledButtonTheme.style!;
          expect(filled.minimumSize!.resolve({})!.height, DesignSizes.controlMd);
          expect(DesignRadius.control, 4);
          expect(DesignRadius.card, 8);
        });

        test('is flat: no shadows or tinted surfaces', () {
          expect(theme.cardTheme.elevation, 0);
          expect(theme.appBarTheme.elevation, 0);
          expect(theme.colorScheme.surfaceTint, Colors.transparent);
        });
      });
    }

    test('the two themes lerp smoothly (needed when the theme switches with an animation)', () {
      final halfway = DumbbillColors.dark.lerp(DumbbillColors.light, 0.5);
      expect(halfway.bgBase, isNot(DumbbillColors.dark.bgBase));
      expect(halfway.bgBase, isNot(DumbbillColors.light.bgBase));
      expect(DumbbillColors.dark.lerp(null, 0.5), same(DumbbillColors.dark));
    });
  });

  group('typography', () {
    test('uses the three product fonts', () {
      expect(AppTypography.ui().fontFamily, 'InterTight');
      expect(AppTypography.numerals().fontFamily, 'BarlowCondensed');
      expect(AppTypography.code().fontFamily, 'JetBrainsMono');
    });

    test('numerals and code fall back to Inter Tight, the only font with the rupee sign', () {
      // Barlow Condensed and JetBrains Mono have no rupee glyph. Without this chain every price would use a random
      // system font for its rupee sign next to our own digits.
      expect(
        AppTypography.numerals().fontFamilyFallback,
        containsAllInOrder(['BarlowCondensedExt', 'InterTight']),
      );
      expect(
        AppTypography.code().fontFamilyFallback,
        containsAllInOrder(['JetBrainsMonoExt', 'InterTight']),
      );
      expect(AppTypography.ui().fontFamilyFallback, ['InterTightExt']);
    });

    test('numbers use tabular figures so columns of prices line up', () {
      for (final style in [AppTypography.ui(), AppTypography.numerals(), AppTypography.code()]) {
        expect(style.fontFeatures, contains(const FontFeature.tabularFigures()));
      }
    });

    test('follows the type scale from the design tokens', () {
      expect(AppTypography.ui().fontSize, DesignFontSizes.body);
      expect(AppTypography.numerals().fontSize, DesignFontSizes.heading);
      expect(AppTypography.code().fontSize, DesignFontSizes.small);
    });
  });
}
