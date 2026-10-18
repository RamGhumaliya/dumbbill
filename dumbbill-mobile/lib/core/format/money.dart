/// Showing money. The twin of `dumbbill-web/src/lib/format/money.ts`.
///
/// Money is ALWAYS whole PAISE (an integer; Rs 1 = 100 paise) everywhere in the code, exactly as the API sends it. It
/// is turned into text only here, at the very edge, so rounding errors from decimal numbers (0.1 + 0.2) can never
/// reach a bill. Never do arithmetic on rupee decimals. Indian digit grouping is used: 1,24,500.00.
library;

import 'package:intl/intl.dart';

final _rupees = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);
final _wholeRupees = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);

/// Formats an amount in paise as rupees, for example `489900` -> `₹4,899.00`.
///
/// With [trimZeroPaise], whole-rupee amounts drop the ".00" (`₹6,694`); real paise are never hidden.
String formatPaise(int paise, {bool trimZeroPaise = false}) {
  if (trimZeroPaise && paise % 100 == 0) return _wholeRupees.format(paise ~/ 100);
  // Integer division first keeps whole rupees exact; only the remainder is fractional.
  return _rupees.format(paise / 100);
}
