/// Which theme the user wants: follow the device, or force dark or light.
library;

import 'package:flutter/material.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'theme_mode_controller.g.dart';

/// Holds the chosen [ThemeMode]. Starts as "follow the device" (the same default as the web app).
///
/// NOTE: the choice is kept only while the app is open. Remembering it between launches arrives with the settings
/// screen in Phase 4 (it needs a small preferences store, which does not exist yet).
@Riverpod(keepAlive: true)
class ThemeModeController extends _$ThemeModeController {
  @override
  ThemeMode build() => ThemeMode.system;

  /// Switches to [mode]. The whole app repaints in the new theme.
  // ignore: use_setters_to_change_properties, a Riverpod notifier method, not a plain property.
  void select(ThemeMode mode) => state = mode;
}
