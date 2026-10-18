/// Generates `lib/core/theme/design_tokens.generated.dart` from `docs/02-design/tokens/tokens.json`.
///
///     dart run tool/generate_tokens.dart            write the file (after editing the json)
///     dart run tool/generate_tokens.dart --check    only check it is up to date and every colour passes contrast
///
/// It refuses to generate anything if a colour pair is too faint to read (WCAG contrast), so an inaccessible
/// palette can never reach the app. The web app does the same from the same file.
library;

import 'dart:convert';
import 'dart:io';

import 'tokens/tokens.dart';

void main(List<String> args) {
  final checkOnly = args.contains('--check');
  final root = File.fromUri(Platform.script).parent.parent; // the dumbbill-mobile folder
  final tokenFile = File('${root.path}/../docs/02-design/tokens/tokens.json');
  final target = File('${root.path}/lib/core/theme/design_tokens.generated.dart');

  final tokens = jsonDecode(tokenFile.readAsStringSync()) as Map<String, dynamic>;

  final problems = validateTokens(tokens);
  if (problems.isNotEmpty) {
    stderr.writeln('Design tokens are not valid:\n${problems.map((p) => '  - $p').join('\n')}');
    exit(1);
  }

  final output = renderDesignTokens(tokens);
  final current = target.existsSync() ? target.readAsStringSync().replaceAll('\r\n', '\n') : '';
  if (current != output) {
    if (checkOnly) {
      stderr.writeln('Out of date: ${target.path}. Run `dart run tool/generate_tokens.dart`.');
      exit(1);
    }
    target.parent.createSync(recursive: true);
    target.writeAsStringSync(output);
    stdout.writeln('Wrote lib/core/theme/design_tokens.generated.dart');
  }

  final report = contrastReport(tokens);
  final tightest = report.reduce((a, b) => a.ratio / a.min < b.ratio / b.min ? a : b);
  stdout.writeln(
    '${report.length} contrast checks passed. Tightest: ${tightest.theme} ${tightest.fg} on ${tightest.bg} = '
    '${tightest.ratio.toStringAsFixed(2)}:1 (needs ${tightest.min}:1).',
  );
}
