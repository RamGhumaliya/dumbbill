/// The System / Dark / Light switch.
library;

import 'package:dumbbill_mobile/core/theme/theme_mode_controller.dart';
import 'package:dumbbill_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A segmented control with three choices. The selected one is filled with the accent colour and also announced to
/// screen readers as selected, so it never relies on colour alone.
class ThemeModeSelector extends ConsumerWidget {
  /// Creates the selector.
  const ThemeModeSelector({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final mode = ref.watch(themeModeControllerProvider);
    return Semantics(
      container: true,
      label: l10n.themeLabel,
      child: SegmentedButton<ThemeMode>(
        showSelectedIcon: false,
        segments: [
          ButtonSegment(value: ThemeMode.system, label: Text(l10n.themeSystem)),
          ButtonSegment(value: ThemeMode.dark, label: Text(l10n.themeDark)),
          ButtonSegment(value: ThemeMode.light, label: Text(l10n.themeLight)),
        ],
        selected: {mode},
        onSelectionChanged: (selection) =>
            ref.read(themeModeControllerProvider.notifier).select(selection.first),
      ),
    );
  }
}
