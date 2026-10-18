/// Reads the design tokens (`docs/02-design/tokens/tokens.json`), checks them, and produces the Dart theme file.
///
/// This is the Flutter twin of `dumbbill-web/scripts/lib/tokens.ts`. Both read the SAME json, apply the SAME checks
/// (every colour role has a value in both themes, every value is a valid colour, every contrast pair meets its WCAG
/// minimum in both themes, every role is covered by a check) and generate their own platform's code.
/// Everything here is a plain function so tests can run it without touching the disk.
library;

import 'contrast.dart';

/// The two themes. Dark is "Iron Ledger", light is "Quiet Ledger".
const themes = ['dark', 'light'];

final _hex = RegExp(r'^#[0-9a-fA-F]{6}$');
final _rgba = RegExp(
  r'^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$',
);

/// "bg.base" -> "bgBase": the Dart field name for a colour role.
String fieldName(String role) {
  final parts = role.split('.');
  return parts.first + parts.skip(1).map((p) => p[0].toUpperCase() + p.substring(1)).join();
}

/// "#0e0f11" -> "Color(0xFF0E0F11)", "rgba(0, 0, 0, 0.65)" -> "Color.fromRGBO(0, 0, 0, 0.65)".
String dartColor(String value) {
  if (_hex.hasMatch(value)) return 'Color(0xFF${value.substring(1).toUpperCase()})';
  final rgba = _rgba.firstMatch(value);
  if (rgba == null) throw FormatException('Not a valid colour: "$value"');
  return 'Color.fromRGBO(${rgba.group(1)}, ${rgba.group(2)}, ${rgba.group(3)}, ${rgba.group(4)})';
}

/// Check the token file is complete and consistent. Returns a list of problems (empty = fine).
List<String> validateTokens(Map<String, dynamic> tokens) {
  final problems = <String>[];
  final color = tokens['color'] as Map<String, dynamic>;
  final roles = (color['roles'] as Map<String, dynamic>).keys.toList();

  for (final theme in themes) {
    final values = (color[theme] as Map<String, dynamic>).cast<String, String>();
    for (final role in roles) {
      final value = values[role];
      if (value == null) {
        problems.add('$theme: role "$role" has no colour.');
      } else if (!_hex.hasMatch(value) && !_rgba.hasMatch(value)) {
        problems.add('$theme: "$role" is not a valid colour: $value');
      }
    }
    for (final role in values.keys) {
      if (!roles.contains(role)) problems.add('$theme: "$role" is not a declared role.');
    }
  }

  final contrast = (tokens['contrast'] as List<dynamic>).cast<Map<String, dynamic>>();
  for (final pair in contrast) {
    final fg = pair['fg'] as String;
    final bg = pair['bg'] as String;
    final min = (pair['min'] as num).toDouble();
    for (final theme in themes) {
      final values = (color[theme] as Map<String, dynamic>).cast<String, String>();
      final a = values[fg];
      final b = values[bg];
      if (a == null || b == null) {
        problems.add('contrast pair "$fg" on "$bg" refers to an unknown role.');
        break;
      }
      // Translucent colours cannot be measured on their own.
      if (!_hex.hasMatch(a) || !_hex.hasMatch(b)) continue;
      final ratio = contrastRatio(a, b);
      if (ratio < min) {
        problems.add(
          '$theme: $fg ($a) on $bg ($b) is ${ratio.toStringAsFixed(2)}:1 but needs $min:1 (${pair['use']}).',
        );
      }
    }
  }

  // Every role must be covered by a contrast check or be explicitly excused, so a new colour cannot slip in unchecked.
  final excused = (tokens['contrastNotRequired'] as Map<String, dynamic>).keys;
  final covered = {
    for (final p in contrast) ...[p['fg'], p['bg']],
    ...excused,
  };
  for (final role in roles) {
    if (!covered.contains(role)) {
      problems.add(
        'role "$role" has no contrast check. Add a pair or list it in contrastNotRequired.',
      );
    }
  }
  return problems;
}

/// Contrast ratios of every pair in both themes (for a readable report and for tests).
List<({String theme, String fg, String bg, double ratio, double min})> contrastReport(
  Map<String, dynamic> tokens,
) {
  final color = tokens['color'] as Map<String, dynamic>;
  final report = <({String theme, String fg, String bg, double ratio, double min})>[];
  for (final theme in themes) {
    final values = (color[theme] as Map<String, dynamic>).cast<String, String>();
    for (final pair in (tokens['contrast'] as List<dynamic>).cast<Map<String, dynamic>>()) {
      final a = values[pair['fg']];
      final b = values[pair['bg']];
      if (a == null || b == null || !_hex.hasMatch(a) || !_hex.hasMatch(b)) continue;
      report.add((
        theme: theme,
        fg: pair['fg'] as String,
        bg: pair['bg'] as String,
        ratio: contrastRatio(a, b),
        min: (pair['min'] as num).toDouble(),
      ));
    }
  }
  return report;
}

/// The full text of `lib/core/theme/design_tokens.generated.dart`.
String renderDesignTokens(Map<String, dynamic> tokens) {
  final color = tokens['color'] as Map<String, dynamic>;
  final roles = (color['roles'] as Map<String, dynamic>).keys.toList();
  final roleInfo = color['roles'] as Map<String, dynamic>;
  final fontSize = (tokens['fontSize'] as Map<String, dynamic>).cast<String, num>();
  final radius = (tokens['radius'] as Map<String, dynamic>).cast<String, num>();
  final size = (tokens['size'] as Map<String, dynamic>).cast<String, num>();
  final motion = tokens['motion'] as Map<String, dynamic>;
  final duration = (motion['duration'] as Map<String, dynamic>).cast<String, num>();
  final easing = (motion['easing'] as Map<String, dynamic>).cast<String, String>();
  final focus = (tokens['focus'] as Map<String, dynamic>).cast<String, num>();
  final font = tokens['font'] as Map<String, dynamic>;

  final b = StringBuffer()
    ..writeln(
      '// GENERATED by `dart run tool/generate_tokens.dart` from docs/02-design/tokens/tokens.json.',
    )
    ..writeln(
      '// DO NOT EDIT BY HAND. Change the JSON and regenerate. (Excluded from formatting and lints.)',
    )
    ..writeln('// dart format off')
    ..writeln('// ignore_for_file: type=lint')
    ..writeln()
    ..writeln(
      '/// The design tokens as Dart code: colours of both themes, type scale, shape, sizes and motion.',
    )
    ..writeln('library;')
    ..writeln()
    ..writeln("import 'package:flutter/material.dart';")
    ..writeln()
    ..writeln(
      '/// The colours of one theme. Read them with `Theme.of(context).extension<DumbbillColors>()!`',
    )
    ..writeln(
      '/// (or the `context.colors` shortcut). Widgets never use raw colours; they use these names.',
    )
    ..writeln('@immutable')
    ..writeln('class DumbbillColors extends ThemeExtension<DumbbillColors> {')
    ..writeln('  /// Creates a colour set.')
    ..writeln('  const DumbbillColors({');
  for (final role in roles) {
    b.writeln('    required this.${fieldName(role)},');
  }
  b
    ..writeln('  });')
    ..writeln();
  for (final role in roles) {
    b
      ..writeln('  /// ${(roleInfo[role] as Map<String, dynamic>)['use']}')
      ..writeln('  final Color ${fieldName(role)};')
      ..writeln();
  }
  for (final theme in themes) {
    final label =
        ((tokens['meta'] as Map<String, dynamic>)['themes'] as Map<String, dynamic>)[theme];
    final values = (color[theme] as Map<String, dynamic>).cast<String, String>();
    b
      ..writeln('  /// $label ($theme theme).')
      ..writeln('  static const $theme = DumbbillColors(');
    for (final role in roles) {
      b.writeln('    ${fieldName(role)}: ${dartColor(values[role]!)},');
    }
    b
      ..writeln('  );')
      ..writeln();
  }
  b
    ..writeln('  @override')
    ..writeln('  DumbbillColors copyWith({');
  for (final role in roles) {
    b.writeln('    Color? ${fieldName(role)},');
  }
  b
    ..writeln('  }) {')
    ..writeln('    return DumbbillColors(');
  for (final role in roles) {
    b.writeln('      ${fieldName(role)}: ${fieldName(role)} ?? this.${fieldName(role)},');
  }
  b
    ..writeln('    );')
    ..writeln('  }')
    ..writeln()
    ..writeln('  @override')
    ..writeln('  DumbbillColors lerp(ThemeExtension<DumbbillColors>? other, double t) {')
    ..writeln('    if (other is! DumbbillColors) return this;')
    ..writeln('    return DumbbillColors(');
  for (final role in roles) {
    b.writeln(
      '      ${fieldName(role)}: Color.lerp(${fieldName(role)}, other.${fieldName(role)}, t)!,',
    );
  }
  b
    ..writeln('    );')
    ..writeln('  }')
    ..writeln('}')
    ..writeln()
    ..writeln('/// Font sizes in logical pixels (the type scale).')
    ..writeln('abstract final class DesignFontSizes {');
  fontSize.forEach((name, value) => b.writeln('  static const double $name = $value;'));
  b
    ..writeln('}')
    ..writeln()
    ..writeln('/// Corner radii: only two exist.')
    ..writeln('abstract final class DesignRadius {');
  radius.forEach((name, value) => b.writeln('  static const double $name = $value;'));
  b
    ..writeln('}')
    ..writeln()
    ..writeln(
      '/// Control and row heights. Touch targets are never below 44; the POS uses controlLg (48).',
    )
    ..writeln('abstract final class DesignSizes {');
  size.forEach((name, value) => b.writeln('  static const double $name = $value;'));
  b
    ..writeln('}')
    ..writeln()
    ..writeln('/// Keyboard/accessibility focus outline.')
    ..writeln('abstract final class DesignFocus {')
    ..writeln('  static const double width = ${focus['width']};')
    ..writeln('  static const double offset = ${focus['offset']};')
    ..writeln('}')
    ..writeln()
    ..writeln(
      '/// Durations and curves for animation. Motion explains a change and never blocks work.',
    )
    ..writeln('abstract final class DesignMotion {');
  duration.forEach(
    (name, value) => b.writeln('  static const Duration $name = Duration(milliseconds: $value);'),
  );
  easing.forEach((name, curve) {
    final numbers = RegExp(r'[\d.]+').allMatches(curve).map((m) => m.group(0)).join(', ');
    b.writeln('  static const Curve $name = Cubic($numbers);');
  });
  b
    ..writeln('  /// How far an element travels while entering, in logical pixels.')
    ..writeln('  static const double shift = ${motion['shift']};')
    ..writeln('}')
    ..writeln()
    ..writeln(
      '/// Font family names, as declared in pubspec.yaml. Each font is two families (latin + latin-ext) because',
    )
    ..writeln(
      '/// Flutter has no per-character font files; they are chained with `fontFamilyFallback`.',
    )
    ..writeln('abstract final class DesignFonts {');
  for (final key in ['ui', 'numerals', 'code']) {
    final family = ((font[key] as Map<String, dynamic>)['family'] as String).replaceAll(' ', '');
    b
      ..writeln("  /// ${(font[key] as Map<String, dynamic>)['use']}.")
      ..writeln("  static const String $key = '$family';")
      ..writeln('  /// Extra characters for [$key].')
      ..writeln("  static const String ${key}Ext = '${family}Ext';");
  }
  b.writeln('}');
  return b.toString();
}
