/// The spacing scale: a 4-pixel grid (design guide section 3). Use these instead of loose numbers so rhythm stays
/// consistent across every screen.
library;

/// Gaps and paddings, in logical pixels.
abstract final class AppSpacing {
  /// 4: hairline gaps, icon to text.
  static const double s1 = 4;

  /// 8: tight groups.
  static const double s2 = 8;

  /// 12: inside controls.
  static const double s3 = 12;

  /// 16: standard gap and screen edge.
  static const double s4 = 16;

  /// 24: between sections.
  static const double s6 = 24;

  /// 32: large separations.
  static const double s8 = 32;

  /// 48: top of a screen, big empty states.
  static const double s12 = 48;
}
