/// A shortcut to the design colours from any widget.
library;

import 'package:dumbbill_mobile/core/theme/design_tokens.generated.dart';
import 'package:flutter/material.dart';

/// `context.colors.textMuted` instead of `Theme.of(context).extension<DumbbillColors>()!.textMuted`.
extension DumbbillThemeContext on BuildContext {
  /// The colours of the current theme (dark or light).
  DumbbillColors get colors => Theme.of(this).extension<DumbbillColors>()!;
}
