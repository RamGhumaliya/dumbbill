/// Builds the app's [ThemeData] for dark ("Iron Ledger") and light ("Quiet Ledger") from the generated design tokens.
///
/// Rule: widgets never contain raw colours or sizes. They use `Theme.of(context)` (colours through the [DumbbillColors]
/// extension, see `theme_context.dart`) and the token classes in `design_tokens.generated.dart`. Material 3 is used for
/// behaviour (focus, semantics, text fields), then restyled so it does not look like a default Material app: two corner
/// radii, hairline borders instead of shadows, a hard rule under headers, one accent colour used sparingly.
library;

import 'package:dumbbill_mobile/core/theme/app_typography.dart';
import 'package:dumbbill_mobile/core/theme/design_tokens.generated.dart';
import 'package:flutter/material.dart';

/// The two themes of the app.
abstract final class AppTheme {
  /// Quiet Ledger: warm white with deep teal.
  static ThemeData light() => _build(DumbbillColors.light, Brightness.light);

  /// Iron Ledger: ink with volt-lime.
  static ThemeData dark() => _build(DumbbillColors.dark, Brightness.dark);

  static ThemeData _build(DumbbillColors c, Brightness brightness) {
    final controlShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(DesignRadius.control),
    );
    final cardShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(DesignRadius.card),
      side: BorderSide(color: c.border),
    );

    final scheme = ColorScheme(
      brightness: brightness,
      primary: c.accent,
      onPrimary: c.accentOn,
      secondary: c.accent,
      onSecondary: c.accentOn,
      error: c.danger,
      onError: c.dangerOn,
      surface: c.bgSurface,
      onSurface: c.text,
      onSurfaceVariant: c.textMuted,
      outline: c.borderControl,
      outlineVariant: c.border,
      surfaceContainerLowest: c.bgBase,
      surfaceContainerLow: c.bgSide,
      surfaceContainer: c.bgSurface,
      surfaceContainerHighest: c.bgHover,
      scrim: c.overlay,
      // No tinted surfaces: the design is flat, colour carries meaning, not decoration.
      surfaceTint: Colors.transparent,
    );

    // Type scale from the tokens. Headings use the condensed numerals face in capitals.
    final textTheme = TextTheme(
      displayLarge: AppTypography.numerals(size: DesignFontSizes.hero, height: 1),
      displayMedium: AppTypography.numerals(
        size: DesignFontSizes.display,
        height: 1.05,
        letterSpacing: 0.4,
      ),
      headlineMedium: AppTypography.numerals(height: 1.1, letterSpacing: 0.4),
      headlineSmall: AppTypography.numerals(
        size: DesignFontSizes.title,
        height: 1.15,
        letterSpacing: 0.4,
      ),
      titleLarge: AppTypography.ui(
        size: DesignFontSizes.title,
        weight: FontWeight.w600,
        height: 1.25,
      ),
      titleMedium: AppTypography.ui(weight: FontWeight.w600, height: 1.3),
      titleSmall: AppTypography.ui(
        size: DesignFontSizes.small,
        weight: FontWeight.w600,
        height: 1.3,
      ),
      bodyLarge: AppTypography.ui(height: 1.5),
      bodyMedium: AppTypography.ui(size: DesignFontSizes.small, height: 1.45),
      bodySmall: AppTypography.ui(size: DesignFontSizes.caption, height: 1.4),
      labelLarge: AppTypography.ui(size: DesignFontSizes.small, weight: FontWeight.w600),
      labelMedium: AppTypography.ui(size: DesignFontSizes.caption, weight: FontWeight.w500),
      labelSmall: AppTypography.ui(
        size: DesignFontSizes.micro,
        weight: FontWeight.w500,
        letterSpacing: 0.8,
      ),
    ).apply(bodyColor: c.text, displayColor: c.text);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: c.bgBase,
      canvasColor: c.bgBase,
      textTheme: textTheme,
      extensions: [c],
      dividerColor: c.border,
      focusColor: c.focusRing,
      // Ripples are a Material default look; a plain, quick highlight suits a till better.
      splashFactory: NoSplash.splashFactory,
      highlightColor: c.bgHover,
      hoverColor: c.bgHover,
      appBarTheme: AppBarTheme(
        backgroundColor: c.bgBase,
        foregroundColor: c.text,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        titleTextStyle: textTheme.headlineSmall?.copyWith(color: c.text),
        shape: Border(bottom: BorderSide(color: c.border)),
      ),
      dividerTheme: DividerThemeData(color: c.border, thickness: 1, space: 1),
      cardTheme: CardThemeData(
        color: c.bgSurface,
        elevation: 0,
        margin: EdgeInsets.zero,
        surfaceTintColor: Colors.transparent,
        shape: cardShape,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: c.accent,
          foregroundColor: c.accentOn,
          minimumSize: const Size(0, DesignSizes.controlMd),
          shape: controlShape,
          textStyle: textTheme.labelLarge,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: c.text,
          minimumSize: const Size(0, DesignSizes.controlMd),
          shape: controlShape,
          side: BorderSide(color: c.borderControl),
          textStyle: textTheme.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: c.text,
          minimumSize: const Size(0, DesignSizes.controlMd),
          shape: controlShape,
          textStyle: textTheme.labelLarge,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.bgSurface,
        hintStyle: textTheme.bodyMedium?.copyWith(color: c.textMuted),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignRadius.control),
          borderSide: BorderSide(color: c.borderControl),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignRadius.control),
          borderSide: BorderSide(color: c.borderControl),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignRadius.control),
          borderSide: BorderSide(color: c.focusRing, width: DesignFocus.width),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignRadius.control),
          borderSide: BorderSide(color: c.danger, width: DesignFocus.width),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignRadius.control),
          borderSide: BorderSide(color: c.danger, width: DesignFocus.width),
        ),
        errorStyle: textTheme.bodySmall?.copyWith(color: c.danger, fontWeight: FontWeight.w600),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: SegmentedButton.styleFrom(
          foregroundColor: c.textMuted,
          selectedForegroundColor: c.accentOn,
          selectedBackgroundColor: c.accent,
          side: BorderSide(color: c.borderControl),
          shape: controlShape,
          minimumSize: const Size(0, DesignSizes.controlSm),
          textStyle: textTheme.labelMedium,
        ),
      ),
      checkboxTheme: CheckboxThemeData(
        shape: controlShape,
        side: BorderSide(color: c.borderControl, width: 1.5),
        fillColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? c.accent : c.bgSurface,
        ),
        checkColor: WidgetStatePropertyAll(c.accentOn),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: c.bgSurface,
        surfaceTintColor: Colors.transparent,
        shape: cardShape,
        titleTextStyle: textTheme.headlineSmall?.copyWith(color: c.text),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: c.bgSurface,
        contentTextStyle: textTheme.bodyMedium?.copyWith(color: c.text),
        shape: cardShape,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}
