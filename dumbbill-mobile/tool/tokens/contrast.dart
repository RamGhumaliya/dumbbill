/// WCAG colour-contrast maths. The Dart twin of `dumbbill-web/scripts/lib/contrast.ts`.
///
/// The contrast ratio says how readable one colour is on another, from 1 (identical) to 21 (black on white).
/// WCAG 2.2 asks for at least 4.5 for normal text and 3 for large text and for the visible edges of controls.
/// The design tokens are checked against these numbers automatically (see tokens.dart), so a colour that is too
/// faint can never be committed.
library;

import 'dart:math' as math;

/// "#1b1f23" or "#fff" -> [27, 31, 35]. Throws a [FormatException] for anything that is not a hex colour.
List<int> parseHex(String hex) {
  final match = RegExp(r'^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$').firstMatch(hex.trim());
  if (match == null) throw FormatException('Not a hex colour: "$hex"');
  var digits = match.group(1)!;
  if (digits.length == 3) {
    digits = digits.split('').map((d) => '$d$d').join();
  }
  return [
    0,
    2,
    4,
  ].map((start) => int.parse(digits.substring(start, start + 2), radix: 16)).toList();
}

/// Relative luminance: how bright a colour appears to the human eye (0 = black, 1 = white).
double luminance(String hex) {
  final channels = parseHex(hex).map((channel) {
    final c = channel / 255;
    // Convert from the screen's gamma-encoded value to linear light.
    return c <= 0.03928 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();
  }).toList();
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/// Contrast ratio between two hex colours (the order does not matter).
double contrastRatio(String a, String b) {
  final la = luminance(a);
  final lb = luminance(b);
  final light = math.max(la, lb);
  final dark = math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}
