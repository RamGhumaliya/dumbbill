// This test reaches into the generator in tool/, which is outside lib/, so it uses relative imports.

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../../tool/tokens/contrast.dart';
import '../../tool/tokens/tokens.dart';

/// The design tokens are the foundation of the whole look, so they are checked hard, exactly like the web app does
/// from the same file: every colour pair meets its WCAG minimum in BOTH themes, every colour role is covered, and the
/// generated Dart is exactly what the JSON says. The "catches mistakes" tests break a copy on purpose.
Map<String, dynamic> loadTokens() {
  final file = File('../docs/02-design/tokens/tokens.json');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

/// A deep copy that tests can damage without touching the real tokens.
Map<String, dynamic> clone() => jsonDecode(jsonEncode(loadTokens())) as Map<String, dynamic>;

Map<String, dynamic> theme(Map<String, dynamic> tokens, String name) =>
    (tokens['color'] as Map<String, dynamic>)[name] as Map<String, dynamic>;

void main() {
  group('contrast maths', () {
    test('black on white is 21:1 and identical colours are 1:1', () {
      expect(contrastRatio('#000000', '#ffffff'), closeTo(21, 0.01));
      expect(contrastRatio('#336699', '#336699'), closeTo(1, 0.0001));
    });

    test('order does not matter and 3-digit colours work', () {
      expect(contrastRatio('#fff', '#000'), closeTo(contrastRatio('#000', '#fff'), 0.0001));
    });

    test('rejects values that are not hex colours', () {
      expect(() => contrastRatio('red', '#fff'), throwsFormatException);
    });
  });

  group('the real tokens', () {
    test('are complete and every contrast pair passes in both themes', () {
      expect(validateTokens(loadTokens()), isEmpty);
    });

    test('check dozens of pairs (the same 54 as the web app)', () {
      final report = contrastReport(loadTokens());
      expect(report.length, 54);
      for (final row in report) {
        expect(
          row.ratio,
          greaterThanOrEqualTo(row.min),
          reason: '${row.theme}: ${row.fg} on ${row.bg}',
        );
      }
    });

    test(
      'the generated Dart file is up to date (run `dart run tool/generate_tokens.dart` if this fails)',
      () {
        final generated = File(
          'lib/core/theme/design_tokens.generated.dart',
        ).readAsStringSync().replaceAll('\r\n', '\n');
        expect(generated, renderDesignTokens(loadTokens()));
      },
    );

    test('colour values are converted exactly, including translucent ones', () {
      expect(dartColor('#c6f432'), 'Color(0xFFC6F432)');
      expect(dartColor('rgba(0, 0, 0, 0.65)'), 'Color.fromRGBO(0, 0, 0, 0.65)');
      expect(() => dartColor('teal'), throwsFormatException);
    });

    test('role names become Dart field names', () {
      expect(fieldName('bg.base'), 'bgBase');
      expect(fieldName('accent.on'), 'accentOn');
      expect(fieldName('text'), 'text');
    });
  });

  group('the checker catches mistakes', () {
    test('a colour that is too faint', () {
      final broken = clone();
      theme(broken, 'light')['text.muted'] = '#b0b0b0';
      expect(validateTokens(broken).join('\n'), contains('light: text.muted'));
    });

    test('a control edge that is too faint (needs 3:1)', () {
      final broken = clone();
      theme(broken, 'dark')['border.control'] = '#222428';
      expect(validateTokens(broken).join('\n'), contains('dark: border.control'));
    });

    test('a role that has a value in only one theme', () {
      final broken = clone();
      theme(broken, 'dark').remove('accent.hover');
      expect(
        validateTokens(broken).join('\n'),
        contains('dark: role "accent.hover" has no colour'),
      );
    });

    test('a value that is not a colour', () {
      final broken = clone();
      theme(broken, 'light')['accent'] = 'teal';
      expect(validateTokens(broken).join('\n'), contains('not a valid colour'));
    });

    test('a new colour role that nobody checked for contrast', () {
      final broken = clone();
      ((broken['color'] as Map<String, dynamic>)['roles'] as Map<String, dynamic>)['brand.extra'] =
          {'tailwind': 'extra', 'use': 'x'};
      theme(broken, 'dark')['brand.extra'] = '#123456';
      theme(broken, 'light')['brand.extra'] = '#654321';
      expect(
        validateTokens(broken).join('\n'),
        contains('role "brand.extra" has no contrast check'),
      );
    });

    test('a contrast pair that names an unknown role', () {
      final broken = clone();
      (broken['contrast'] as List<dynamic>).add({
        'fg': 'text',
        'bg': 'bg.nowhere',
        'min': 4.5,
        'use': 'x',
      });
      expect(validateTokens(broken).join('\n'), contains('unknown role'));
    });
  });
}
