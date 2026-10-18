// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get themeLabel => 'Colour theme';

  @override
  String get themeSystem => 'System';

  @override
  String get themeDark => 'Dark';

  @override
  String get themeLight => 'Light';

  @override
  String referenceLabel(String code) {
    return 'Reference: $code';
  }

  @override
  String get ownerTitle => 'Owner dashboard';

  @override
  String get ownerSubtitle => 'Sales, stock and profit across your branches will appear here.';

  @override
  String get ownerSampleHeading => 'Preview of the dashboard';

  @override
  String get sampleNotice => 'Sample figures for layout only. Not real data.';

  @override
  String get ownerSampleSales => 'Sales today';

  @override
  String get ownerSampleBills => 'Bills';

  @override
  String get ownerSampleProfit => 'Gross profit';

  @override
  String get ownerSampleLowStock => 'Low stock';

  @override
  String get customerTitle => 'Your shops';

  @override
  String get customerSubtitle =>
      'Join a shop with its code or QR to collect points and see its offers.';

  @override
  String get customerSampleHeading => 'Preview of a shop card';

  @override
  String get customerSampleShop => 'FitFuel Nutrition, Andheri West';

  @override
  String get customerSamplePointsLabel => 'points';

  @override
  String customerSamplePointsWorth(String amount) {
    return 'worth $amount';
  }

  @override
  String get customerSampleOffer => '₹150 off creatine on orders above ₹1,499';

  @override
  String get customerSampleOfferExpiry => 'Expires 31 Oct';

  @override
  String get statusHeading => 'System status';

  @override
  String get statusChecking => 'Checking the server';

  @override
  String get statusReady => 'Server is ready';

  @override
  String get statusDatabaseUp => 'Database connected';

  @override
  String get statusDatabaseDown => 'Database not reachable';

  @override
  String get statusUnreachable => 'Cannot reach the server';

  @override
  String get statusUnreachableHint =>
      'Start the API (see the dumbbill-backend README) and try again.';

  @override
  String get statusProblem => 'The server answered with a problem';

  @override
  String get statusApiAddress => 'API address';

  @override
  String get tryAgain => 'Try again';
}
